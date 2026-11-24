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
cp .env.example backend/.env   # local Postgres runs on host port 5433 (5432 was taken by a native service)

cd backend && npm install && npm run db:migrate && npm run db:seed && npm run dev
cd frontend && npm install && npm run dev
```

Backend health check: `GET http://localhost:4000/health` → `{"data":{"status":"ok"}}`

Seeded test logins (role / email, password `password123` for all): salesman@porulottam.test, admin@porulottam.test, production@porulottam.test, accountant@porulottam.test, owner@porulottam.test.

## Status

Phase 0–2 complete: project scaffold, local Postgres via Docker (port 5433), API conventions/error-handling/validation, full Prisma schema + idempotent seed with the benchmark's opening stock, BOM (expected yield 200, not 238) and customers.
See the build plan for the full 19-phase roadmap.
