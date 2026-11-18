import type { IncomingMessage, ServerResponse } from 'node:http';

// Public configuration only. Sending requires a separate authenticated,
// centrally rate-limited design; an Origin header is not authentication.
export async function handlePush(method: string) {
  if (method !== 'GET') return { status: 405, body: { error: 'このAPIから通知は送信できません。' } };
  const publicKey = process.env.PUSH_VAPID_PUBLIC_KEY;
  if (!publicKey) return { status: 503, body: { error: '通知の準備ができていません。' } };
  return { status: 200, body: { publicKey } };
}
export default async function handler(request: IncomingMessage, response: ServerResponse) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Allow', 'GET');
  const result = await handlePush(request.method ?? 'GET');
  response.writeHead(result.status).end(JSON.stringify(result.body));
}
