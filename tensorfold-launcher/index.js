/**
 * Host half: an owner-only POST route that opens TensorFold Bar. Opening it while it is
 * already running only re-activates it, so the route is safe to call repeatedly.
 */
import { spawn } from 'node:child_process'

export const name = 'tensorfold-launcher'
export const inject = ['webServer']

const PATH = '/tensorfold-bar/open'
const BUNDLE_ID = 'com.larssteenhoff.TensorFoldBar'

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    auth: 'required',
    path: PATH,
    handler: (req, res, peer) => {
      if (peer?.principal.kind !== 'owner') return reply(res, 403, { code: 'forbidden' })
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST')
        return reply(res, 405, { code: 'method-not-allowed' })
      }
      // `open -b` exits non-zero when no installed app has the bundle id.
      const child = spawn('/usr/bin/open', ['-b', BUNDLE_ID], { stdio: 'ignore' })
      child.once('error', () => reply(res, 500, { code: 'launch-failed' }))
      child.once('exit', (code) => {
        if (!res.headersSent) reply(res, code === 0 ? 200 : 404, code === 0 ? { opened: true } : { code: 'not-installed' })
      })
    },
  }), `tensorfold-launcher: POST ${PATH}`)
}
