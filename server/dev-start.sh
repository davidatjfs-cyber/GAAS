#!/bin/bash
cd "$(dirname "$0")"
export DATABASE_URL="postgres://hrms:hrms@localhost:5432/hrms"
export JWT_SECRET="test_secret_123"
export ENABLE_DB_WRITE="true"
export PORT="3000"
exec node index.js
