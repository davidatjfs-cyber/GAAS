/**
 * 试菜验证清单生成器（阶段 1）：把匹配体检 + 风险预判转成试菜会要回答的问题。
 */

export function buildTastingChecklist({ dish, match, risks }) {
  const questions = [];
  const priceRisk = risks.find((r) => r.risk === '价格偏高' || r.risk === '高价非招牌');
  const spiceRisk = risks.find((r) => r.risk === '辣度过高');
  const rawRisk = risks.find((r) => r.risk === '生食接受度');
  const oilyRisk = risks.find((r) => r.risk === '油腻/健康感');
  const portionRisk = risks.find((r) => r.risk === '分量不足');
  const newRisk = risks.find((r) => r.risk === '新品不确定性');

  if (priceRisk) {
    questions.push({
      question: `${dish.price} 元的定价，目标客群是否觉得值？（价格敏感客群可能不接受）`,
      focus: '定价验证',
      related_segments: priceRisk.segment,
    });
  }
  if (spiceRisk) {
    questions.push({
      question: '辣度对老人/孩子是否合适？是否需要提供不辣版本？',
      focus: '口味验证',
      related_segments: spiceRisk.segment,
    });
  }
  if (rawRisk) {
    questions.push({
      question: '生食做法的新鲜度与肠胃接受度如何？老人/孩子是否建议避开？',
      focus: '食材与安全验证',
      related_segments: rawRisk.segment,
    });
  }
  if (oilyRisk) {
    questions.push({
      question: '油腻感是否在可接受范围？是否需要调整火候或搭配解腻配菜？',
      focus: '口味验证',
      related_segments: oilyRisk.segment,
    });
  }
  if (portionRisk) {
    questions.push({
      question: '分量对 2-4 人是否足够？是否需要调整份量或价格？',
      focus: '分量验证',
      related_segments: portionRisk.segment,
    });
  }
  if (!questions.length && match.main_segments.length) {
    questions.push({
      question: `按体检结果，这道菜主攻「${match.main_segments.slice(0, 3).join('、')}」客群——试菜时请重点验证这些客群的代表性意见`,
      focus: '客群匹配验证',
      related_segments: match.main_segments.slice(0, 3).join('、'),
    });
  }
  if (newRisk && !questions.some((q) => q.focus === '口味验证')) {
    questions.push({
      question: '作为新品，口味稳定性与出品一致性是否达标？',
      focus: '出品稳定性验证',
      related_segments: newRisk.segment,
    });
  }
  return questions.slice(0, 5);
}
