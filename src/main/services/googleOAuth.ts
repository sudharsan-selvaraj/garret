import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { shell } from 'electron'

// Installed-app OAuth: open the system browser, capture the redirect on a
// 127.0.0.1 loopback (Google auto-allows loopback for Desktop clients, no
// pre-registration), exchange the code with PKCE. Read-only Calendar scope.
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'openid', 'email'].join(' ')
const TIMEOUT_MS = 180_000

const b64url = (b: Buffer): string =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export interface GoogleTokens {
  refreshToken: string
  accessToken: string
  expiresAt: number
  email: string
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  error?: string
  error_description?: string
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  })
  const json = (await res.json()) as TokenResponse
  if (!res.ok || json.error) {
    throw new Error(`Google token error: ${json.error_description || json.error || res.status}`)
  }
  return json
}

async function fetchEmail(accessToken: string): Promise<string> {
  try {
    const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) return ''
    const j = (await res.json()) as { email?: string }
    return j.email ?? ''
  } catch {
    return ''
  }
}

/** Interactive sign-in: opens the browser, captures the loopback redirect, returns tokens. */
export async function runOAuth(clientId: string, clientSecret: string): Promise<GoogleTokens> {
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>(
    (resolve, reject) => {
      let redirectUri = ''
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', redirectUri || 'http://127.0.0.1')
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        if (!code && !error) {
          // Stray request (e.g. favicon) — ignore, keep waiting.
          res.statusCode = 204
          res.end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(
          '<!doctype html><meta charset="utf-8"><body style="font-family:-apple-system,sans-serif;background:#1c1c1e;color:#fff;display:flex;height:100vh;align-items:center;justify-content:center;margin:0"><div style="text-align:center"><h2>Connected to MyView ✓</h2><p>You can close this tab and return to MyView.</p></div>'
        )
        clearTimeout(timer)
        server.close()
        if (error) return reject(new Error('Google sign-in was cancelled.'))
        if (url.searchParams.get('state') !== state) return reject(new Error('OAuth state mismatch.'))
        resolve({ code: code as string, redirectUri })
      })
      server.on('error', reject)
      const timer = setTimeout(() => {
        server.close()
        reject(new Error('Google sign-in timed out.'))
      }, TIMEOUT_MS)
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo
        redirectUri = `http://127.0.0.1:${port}`
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: SCOPES,
          access_type: 'offline',
          prompt: 'consent',
          state,
          code_challenge: challenge,
          code_challenge_method: 'S256'
        })
        void shell.openExternal(`${AUTH_URL}?${params.toString()}`)
      })
    }
  )

  const tok = await postToken({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code_verifier: verifier
  })
  if (!tok.refresh_token) {
    throw new Error(
      'No refresh token returned. Revoke MyView at myaccount.google.com/permissions, then reconnect.'
    )
  }
  const email = await fetchEmail(tok.access_token)
  return {
    refreshToken: tok.refresh_token,
    accessToken: tok.access_token,
    expiresAt: Date.now() + tok.expires_in * 1000,
    email
  }
}

/** Exchange a stored refresh token for a fresh access token. */
export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: number }> {
  const tok = await postToken({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken
  })
  return { accessToken: tok.access_token, expiresAt: Date.now() + tok.expires_in * 1000 }
}
