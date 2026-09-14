# ISTSA Dinner & Awards voting

A lightweight voting site for the Information Systems & Technology Students Association. Each vote costs **GH₵0.50** (50 pesewas) and is recorded only after Paystack confirms a successful payment.

## Run it

1. Copy `.env.example` to `.env` and set a Paystack **secret** key. Do not put the secret key in frontend files.
2. In PowerShell for this folder, set the values for the session and start it:

   ```powershell
   $env:PAYSTACK_SECRET_KEY='sk_test_your_key'
   $env:PUBLIC_URL='http://localhost:3000'
   npm start
   ```

3. Open `http://localhost:3000`.

For a deployed site, set `PUBLIC_URL` to its HTTPS URL. Paystack redirects there after payment.

## Customize nominees

Update the `nominees` object near the top of `server.js`. Its format is:

```js
'Award category': ['NOM-01', 'NOM-02']
```

The displayed code is the vote code. Replace the sample category names/codes with the approved award ballot before publishing.

## Important production work

This starter intentionally stores payment attempts and completed votes in memory, which resets when the server restarts. Before using it for the live Awards Night, connect `voteAttempts` and `votes` to a database and implement a Paystack webhook handler. The webhook should verify Paystack’s signature and make recording a paid reference idempotent; that ensures votes are retained even if a guest closes the confirmation page.

Also restrict the admin/results view, publish a privacy notice for voter emails, and use a Paystack live secret key only after testing the complete flow with a test key.
