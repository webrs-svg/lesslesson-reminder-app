# Deploy on Vercel + Supabase

## 1. Create Supabase project

1. Create a new project in Supabase.
2. Open the SQL editor and run `supabase/schema.sql`.
3. Copy these values from Project Settings:
   - `Project URL`
   - `anon public key`
   - `service_role key`

## 2. Configure local environment

1. Copy `.env.example` to `.env.local`.
2. Fill in:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

## 3. Seed the demo accounts

Run:

```bash
npm run seed:demo
```

This creates:

- `admin@academy.app` / `admin123`
- `olivia@academy.app` / `teacher123`
- `emma@academy.app` / `student123`

## 4. Deploy to Vercel

1. Create a new Vercel project from this folder or GitHub repository.
2. Add the same three environment variables in the Vercel dashboard.
3. Deploy.

## 5. What this deployment supports

- Hosted login with Supabase email/password auth
- Admin-managed user creation through the Vercel serverless route
- Shared lesson data across devices
- Installable PWA in Chrome
- Service-worker-driven reminder notifications while the app is active on the device

## 6. Important note about full background push

This project is prepared for browser notifications and PWA installability, but truly reliable scheduled push delivery while the app is fully closed still needs one more backend layer, such as:

- Firebase Cloud Messaging
- Web Push subscriptions stored in Supabase plus a scheduled server job

The current deployment is live-ready for hosted login and shared data, and it keeps the notification flow in the browser app itself.
