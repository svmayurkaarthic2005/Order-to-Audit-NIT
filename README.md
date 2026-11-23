# Porulottam ERP (பொருளோட்டம்)

Order-to-Audit system for a small food manufacturer. NIT Tiruchirappalli internship submission.

## Stack

- Frontend: React + Vite + TypeScript + Tailwind CSS + shadcn/ui + React Router + TanStack Query
- Backend: Node.js + Express + TypeScript + Prisma
- Database: PostgreSQL
- Auth: JWT + bcrypt + RBAC
- Testing: Vitest
- Invoicing: PDFKit + Supabase Storage + WhatsApp click-to-chat (`wa.me`)

## Setup

```
docker compose up -d
cp .env.example .env   # fill in DATABASE_URL etc.

cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

Backend health check: `GET http://localhost:4000/health` → `{"status":"ok"}`

## Status

Phase 0 complete: project scaffold, local Postgres via Docker, health-check endpoint and test, themed frontend shell.
See the build plan for the full 19-phase roadmap.
