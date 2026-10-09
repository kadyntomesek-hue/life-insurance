# Life Insurance CRM portal. Runs anywhere Docker runs (Railway, Fly.io, Render, a VPS).
FROM python:3.12-slim
WORKDIR /app
COPY . /app
# Data (login, clients, policies, bank) lives on a persistent volume mounted at /data.
ENV DATA_DIR=/data PORT=3000 HOST=0.0.0.0 COOKIE_SECURE=true TRUST_PROXY=1 PYTHONUNBUFFERED=1
VOLUME ["/data"]
EXPOSE 3000
CMD ["python", "server.py"]
