import test from 'node:test'
import assert from 'node:assert/strict'
import { app, isValidLap, isValidPassword, isValidUsername } from '../index.js'

test('username validation accepts supported usernames only', () => {
  assert.equal(isValidUsername('quiet_clock7'), true)
  assert.equal(isValidUsername('ab'), false)
  assert.equal(isValidUsername('bad name'), false)
})

test('password validation enforces length and bcrypt byte limit', () => {
  assert.equal(isValidPassword('correct horse battery'), true)
  assert.equal(isValidPassword('short'), false)
  assert.equal(isValidPassword('é'.repeat(37)), false)
})

test('lap validation requires ordered positive split and total times', () => {
  const lap = {
    sessionId: '4c4ae76b-92c1-4ad9-8a20-05cfa40266c2',
    lapNumber: 1,
    splitMs: 1200,
    totalMs: 1200,
  }

  assert.equal(isValidLap(lap), true)
  assert.equal(isValidLap({ ...lap, splitMs: 1300 }), false)
  assert.equal(isValidLap({ ...lap, lapNumber: 0 }), false)
})

test('private note and lap endpoints reject unauthenticated requests', async (context) => {
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))

  const { port } = server.address()
  const invalidRegistration = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: JSON.stringify({ username: 'bad name', password: 'long-enough-password' }),
  })
  assert.equal(invalidRegistration.status, 400)

  for (const route of ['/api/notes', '/api/laps']) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      headers: { Connection: 'close' },
    })
    assert.equal(response.status, 401)
  }
})

test('HTTP logs are structured and omit query strings', async (context) => {
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))

  const { port } = server.address()
  const log = console.log
  const errorLog = console.error
  const logs = []
  console.log = (entry) => logs.push(entry)
  console.error = (entry) => logs.push(entry)

  let response
  try {
    response = await fetch(`http://127.0.0.1:${port}/api/health?token=do-not-log`, {
      headers: { Connection: 'close' },
    })
  } finally {
    console.log = log
    console.error = errorLog
  }

  assert.ok(response.headers.get('x-request-id'))
  const requestLog = logs.map((entry) => JSON.parse(entry)).find((entry) => entry.event === 'http.request')
  assert.ok(requestLog)
  assert.equal(requestLog.path, '/api/health')
  assert.equal(requestLog.status_code, 503)
  assert.equal(JSON.stringify(requestLog).includes('do-not-log'), false)
})
