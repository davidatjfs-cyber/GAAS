/**
 * Knowledge base HTTP routes — thin handlers.
 * Business logic lives in service.js; multer upload stays here.
 */
import { registerKnowledgeFileRoute } from './routes-file.js';
import { registerKnowledgeReadRoutes } from './routes-read.js';
import { registerKnowledgeWriteRoutes } from './routes-write.js';

export function registerKnowledgeRoutes(app, deps) {
  registerKnowledgeFileRoute(app, deps);
  registerKnowledgeReadRoutes(app, deps);
  registerKnowledgeWriteRoutes(app, deps);
}
