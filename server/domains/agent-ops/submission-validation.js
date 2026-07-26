/**
 * Ops 巡检提交校验 API（P2 peel from agents.js）。
 * 供 createPollBitableSubmissions / processOpsChecklistSubmissions 注入。
 */
import { extractScore, validateSubmissionLogic } from './submission-validation-helpers.js';
import {
  checkPhotoDuplicate as checkPhotoDuplicateIo,
  validatePhotoAuthenticityBody,
} from './submission-validation-io.js';

/**
 * @param {object} deps
 * @param {() => { query: Function }} deps.pool
 * @param {Function} deps.callVisionLLM
 * @param {{ info: Function, error: Function }} deps.log
 */
export function createOpsSubmissionValidation(deps) {
  const { pool, callVisionLLM, log } = deps;

  async function checkPhotoDuplicate(photoHash) {
    return checkPhotoDuplicateIo(pool, photoHash, log);
  }

  async function validatePhotoAuthenticity(imageUrl, expectedLocation, submitTime) {
    return validatePhotoAuthenticityBody(
      { callVisionLLM, checkPhotoDuplicate, log },
      imageUrl,
      expectedLocation,
      submitTime,
    );
  }

  async function validateSubmissionLogicLogged(submission) {
    log.info('[ops] validating submission logic...');
    return validateSubmissionLogic(submission);
  }

  return {
    extractScore,
    validatePhotoAuthenticity,
    checkPhotoDuplicate,
    validateSubmissionLogic: validateSubmissionLogicLogged,
  };
}
