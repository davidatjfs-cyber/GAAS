/**
 * Bitable submission poller (Wave A4b peel from agents.js pollBitableSubmissions).
 * Dedup Sets/Maps stay in agents.js and are injected by reference.
 */
import { resolveTenantIdDefault } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'feishu-bitable', handler: 'poll-submissions' });

const TRANSIENT_ERRORS = new Set([
  '1254607_data_not_ready', '1254607', '1255001', '1255002', '1255003',
  '1255004', '1255005', '1255040', 'ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED',
  'timeout of 10000ms exceeded',
]);

/**
 * @param {object} deps
 * @returns {(configKey?: string) => Promise<void>}
 */
export function createPollBitableSubmissions(deps) {
  const {
    pool,
    bitableConfigs,
    processedRecordIds,
    lastProcessedTime,
    dedupMaxKeys = 30000,
    dedupCleanCount = 8000,
    seedBitableDedup,
    getBitableRecords,
    extractRelationsFromBitableRecord,
    processBitableData,
    validateSubmissionLogic,
    validatePhotoAuthenticity,
    getBitableRecordImageDownloadUrl,
    callVisionLLM,
    extractScore,
    deduplicateMessage,
    sendLarkMessage,
    prefixWithAgentName,
  } = deps;

  return async function pollBitableSubmissions(configKey = 'ops_checklist') {

    const cfg = bitableConfigs[configKey];
    if (!cfg?.tableId) { return; }
    await seedBitableDedup();
    log.info({ msg: 'bitable_poll', detail: [`[bitable][${configKey}] polling submissions...`] });

    const records = [];
    let pageToken = '';
    let page = 0;
    while (page < 20) {
      const result = await getBitableRecords(configKey, { pageSize: 200, pageToken });
      if (!result.ok) {
        const isTransient = TRANSIENT_ERRORS.has(result.error) || /data not ready|internalerror|timeout|ECONNRESET|socket hang up|1254607|1255001|1255002|1255003|1255004|1255005|1255040/i.test(String(result.error || ''));
        if (isTransient) {
          log.info({ msg: 'bitable_poll', detail: [`[bitable][${configKey}] transient error, will retry next cycle: ${String(result.error).slice(0, 100)}`] });
        } else {
          log.error({ msg: 'bitable_poll', detail: [`[bitable][${configKey}] poll failed:`, result.error] });
        }
        return;
      }
      records.push(...(result.records || []));
      if (!result.hasMore || !result.nextPageToken) break;
      pageToken = result.nextPageToken;
      page += 1;
    }

    const newSubmissions = [];
    const newRecords = [];
  
    for (const record of records) {
      const recordId = record.record_id;
      const createdTime = record.created_time;
      const fields = record.fields || {};
    
      // 检查是否已处理过（使用 recordId 去重）
      const processedKey = `${configKey}_${recordId}`;
      if (processedRecordIds.has(processedKey)) {
        continue;
      }
    
      // 解析表单数据
      const submission = {
        configKey,
        recordId,
        createdTime,
        submitter: fields['提交人'] || '',
        store: fields['所属门店'] || '',
        checkType: fields['检查类型'] || '',
        checkStatus: fields['检查状态'] || '',
        checkRemark: fields['检查说明'] || '',
        checkPhotos: fields['检查照片'] || [],
        submitTime: fields['提交日期'] || createdTime,
        fields
      };
    
      log.info({ msg: 'bitable_poll', detail: [`[bitable][${configKey}] new submission:`, submission] });
      newSubmissions.push(submission);
      newRecords.push(record);
    
      // 标记为已处理
      processedRecordIds.add(processedKey);
      lastProcessedTime.set(processedKey, createdTime);
    
      // 限制内存中的记录数量
      if (processedRecordIds.size > dedupMaxKeys) {
        const oldestIds = Array.from(processedRecordIds).slice(0, dedupCleanCount);
        oldestIds.forEach(id => {
          processedRecordIds.delete(id);
          lastProcessedTime.delete(id);
        });
        log.info({ msg: 'bitable_poll', detail: ['[bitable] cleaned up old processed records, current size:', processedRecordIds.size] });
      }
    }
  
    if (newSubmissions.length > 0) {
      log.info({ msg: 'bitable_poll', detail: [`[bitable][${configKey}] processed ${newSubmissions.length} new submissions`] });

      // 统一写入 feishu_generic_records，确保 BI 可查询所有数据源
      const config = bitableConfigs[configKey];
      for (const record of newRecords) {
        try {
          await pool().query(
            `INSERT INTO feishu_generic_records (app_token, table_id, record_id, fields, raw, created_at, updated_at, tenant_id)
             VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, NOW(), NOW(), $6)
             ON CONFLICT (app_token, table_id, record_id, tenant_id) DO UPDATE SET
               fields = EXCLUDED.fields, raw = EXCLUDED.raw, updated_at = NOW()`,
            [
              config?.appToken || '',
              config?.tableId || '',
              record.record_id,
              JSON.stringify(record.fields || {}),
              JSON.stringify(record),
              resolveTenantIdDefault()
            ]
          );
        } catch (e) {
          if (!String(e?.message || '').includes('duplicate')) {
            log.error({ msg: 'bitable_poll', detail: [`[bitable][${configKey}] save generic record failed:`, e?.message] });
          }
        }
      }

      // 知识图谱: 从新记录中抽取实体关系 (确定性规则, 零LLM成本)
      for (const record of newRecords) {
        try { await extractRelationsFromBitableRecord(record, configKey); } catch (e) { /* ignore */ }
      }

      // 仅处理"本轮新增记录"，避免高量表每轮重复全量处理导致其它表饥饿
      await processBitableData(configKey, newRecords);
    
      // 如果是检查表类型，继续原有的确认消息逻辑
      if (configKey === 'ops_checklist') {
        // 处理每条提交记录
        for (const sub of newSubmissions) {
          // 1. 逻辑纠偏检查
          const logicValidation = await validateSubmissionLogic(sub);
          if (!logicValidation.isValid) {
            // 打回重拍
            if (sub.submitter && sub.submitter.id) {
              const rejectMessage = `❌ 提交被驳回\n${logicValidation.suggestion}\n请核实后重新提交。`;
              await sendLarkMessage(sub.submitter.id, prefixWithAgentName('ops_supervisor', rejectMessage));
              continue;
            }
          }
        
          // 2. 照片真实性验证
          let photoValidationResults = [];
          if (sub.checkPhotos && sub.checkPhotos.length > 0) {
            for (const photo of sub.checkPhotos) {
              if (photo.file_token) {
                const imageUrl = await getBitableRecordImageDownloadUrl(photo.file_token);
                if (imageUrl) {
                  const validation = await validatePhotoAuthenticity(imageUrl, sub.store, sub.submitTime);
                  photoValidationResults.push({
                    fileName: photo.name,
                    validation
                  });
                
                  // 如果照片不真实，直接拒绝
                  if (!validation.isAuthentic) {
                    if (sub.submitter && sub.submitter.id) {
                      const rejectMessage = `🚫 照片验证失败\n检测到：${!validation.timeValid ? '时间异常' : ''}${!validation.notDuplicate ? '照片重复' : ''}${!validation.locationMatch ? '地点不符' : ''}\n请重新拍摄真实照片。`;
                      await sendLarkMessage(sub.submitter.id, prefixWithAgentName('ops_supervisor', rejectMessage));
                    }
                    continue;
                  }
                }
              }
            }
          }
        
          // 3. 图片识别分析
          let visionResults = [];
          if (sub.checkPhotos && sub.checkPhotos.length > 0) {
            log.info({ msg: 'bitable_poll', detail: [`[bitable] processing ${sub.checkPhotos.length} photos for record ${sub.recordId}`] });
          
            for (const photo of sub.checkPhotos) {
              if (photo.file_token) {
                const imageUrl = await getBitableRecordImageDownloadUrl(photo.file_token);
                if (imageUrl) {
                  try {
                    const visionResult = await callVisionLLM([
                      { type: 'image', image_url: imageUrl },
                      { type: 'text', text: `请检查这张餐厅${sub.checkType}照片，评估：1.卫生状况 2.安全规范 3.整体状态。给出评分(1-10分)和具体问题。` }
                    ]);
                  
                    visionResults.push({
                      fileName: photo.name,
                      result: visionResult.content || '识别失败',
                      score: extractScore(visionResult.content) || 0
                    });
                  
                    log.info({ msg: 'bitable_poll', detail: [`[bitable] vision result for ${photo.name}:`, visionResult.content?.substring(0, 100) + '...'] });
                  } catch (e) {
                    log.error({ msg: 'bitable_poll', detail: [`[bitable] vision analysis failed for ${photo.file_token}:`, e?.message] });
                    visionResults.push({
                      fileName: photo.name,
                      result: '图片识别失败',
                      score: 0
                    });
                  }
                }
              }
            }
          }
        
          // 4. 构建确认消息
          let reply = `✅ 已收到你的${sub.checkType}提交\n门店：${sub.store}\n状态：${sub.checkStatus}\n说明：${sub.checkRemark}\n照片：${sub.checkPhotos.length}张\n提交时间：${new Date(sub.submitTime).toLocaleString()}\n`;
        
          // 添加照片验证结果
          if (photoValidationResults.length > 0) {
            reply += `\n🔍 照片验证：全部通过真实性检查`;
          }
        
          // 添加图片识别结果
          if (visionResults.length > 0) {
            const avgScore = visionResults.reduce((sum, r) => sum + r.score, 0) / visionResults.length;
            reply += `\n\n🎯 图片识别结果：\n平均评分：${avgScore.toFixed(1)}/10`;
            visionResults.forEach((r, i) => {
              reply += `\n${i + 1}. ${r.fileName}：${r.score}/10 - ${r.result.substring(0, 30)}...`;
            });
          }
        
          reply += `\n\n系统已记录，感谢配合！`;
        
          // 5. 存储识别结果到数据库（添加去重检查）
          try {
            const messageKey = `${sub.submitter.id}-${sub.recordId}-vision_analysis`;
            if (!deduplicateMessage(messageKey, 'system')) {
              log.info({ msg: 'bitable_poll', detail: ['[bitable] vision analysis message deduplicated'] });
            } else {
              await pool().query(
                `INSERT INTO agent_messages (direction, channel, feishu_open_id, sender_username, sender_name, sender_role, routed_to, content_type, content, agent_data, tenant_id)
                 VALUES ('out','feishu',$1,$2,$3,$4,'ops_supervisor','vision_analysis',$5,$6::jsonb,$7)`,
                [sub.submitter.id, sub.submitter.name || sub.submitter.id, sub.submitter.name || sub.submitter.id, '',
                 `${sub.checkType}图片识别分析`, JSON.stringify({ recordId: sub.recordId, visionResults, photoValidationResults, avgScore: visionResults.reduce((sum, r) => sum + r.score, 0) / visionResults.length }), resolveTenantIdDefault()]
              );
            }
          } catch (e) { /* ignore */ }
        
          // 6. 存储结构化数据到本地数据库（含 record_id 去重）
          try {
            await pool().query(
              `INSERT INTO agent_messages (direction, channel, feishu_open_id, sender_username, sender_name, sender_role, routed_to, content_type, content, agent_data, record_id, tenant_id)
               VALUES ('in','feishu',$1,$2,$3,$4,'ops_supervisor','bitable_submission',$5,$6::jsonb,$7,$8)
               ON CONFLICT (record_id, content_type) WHERE record_id IS NOT NULL AND record_id != ''
               DO UPDATE SET content = EXCLUDED.content, agent_data = EXCLUDED.agent_data, updated_at = NOW()`,
              [sub.submitter.id, sub.submitter.name || sub.submitter.id, sub.submitter.name || sub.submitter.id, '',
               `${sub.checkType}提交（Bitable）`, JSON.stringify(submission), sub.recordId || '', resolveTenantIdDefault()]
            );
          } catch (e) { /* ignore */ }
        
          // 7. 发送确认消息
          await sendLarkMessage(sub.submitter.id, prefixWithAgentName('ops_supervisor', reply));
        }
      }
    }

  };
}
