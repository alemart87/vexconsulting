#!/bin/sh
set -e

# Backend FastAPI en puerto interno 8000
cd /app/backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Esperar a que el backend esté listo
sleep 3

# Frontend Next.js en el puerto que Render asigna ($PORT)
cd /app/frontend
PORT=${PORT:-8080} HOSTNAME=0.0.0.0 node server.js &
FRONTEND_PID=$!

wait $BACKEND_PID $FRONTEND_PID
