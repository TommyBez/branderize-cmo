# Branderize console

The authenticated product console runs on port 3001.

Use a dedicated branch in the non-production Neon project. `DATABASE_URL`
points to that branch's pooled endpoint and `DIRECT_DATABASE_URL` points to its
direct endpoint for migrations. Local application development does not use
Docker.

Preview and production sign-in use Better Auth email OTP, a React Email
template, `RESEND_API_KEY`, and a verified `RESEND_FROM_EMAIL`. Do not commit
either value.

Run migrations explicitly, then start the complete local fleet from the
repository root:

```sh
cd apps/app
node --env-file=.env.local --run=db:migrate
cd ../..
pnpm dev:local
```

The supervisor enables a server-only local OTP mode after fixing the app to a
loopback origin. It sends no email and accepts any non-empty code of up to six
characters. Do not add the bypass marker to `.env.local` or any Vercel
environment.

Use pnpm 11.22.0 for every local and CI command.
