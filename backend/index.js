import bcrypt from 'bcryptjs'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

dotenv.config({ path: new URL('.env', import.meta.url) })

const app = express()
const tokenIssuer = 'still-clock-api'
const serviceName = 'still-clock-api'
const maximumLapDuration = 100 * 24 * 60 * 60 * 1000
const allowedOrigins = (process.env.CLIENT_ORIGINS || 'http://localhost:5173,https://stopwatch.alfar.ca')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

function logEvent(level, event, fields = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: serviceName,
    event,
    ...fields,
  }
  const output = JSON.stringify(entry)
  if (level === 'error') {
    console.error(output)
  } else {
    console.log(output)
  }
}

function requestLogFields(request) {
  return {
    request_id: request.requestId,
    method: request.method,
    path: request.path,
    ...(request.userId ? { user_id: request.userId } : {}),
  }
}

function errorLogFields(error) {
  const fields = { error_type: error?.name || 'Error' }
  if (typeof error?.code === 'number') fields.error_code = error.code
  if (typeof error?.code === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(error.code)) {
    fields.error_code = error.code
  }
  return fields
}

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, minlength: 3, maxlength: 24 },
  passwordHash: { type: String, required: true, select: false },
}, { timestamps: true })

const noteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  text: { type: String, required: true, maxlength: 500 },
}, { timestamps: true })

const lapSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sessionId: { type: String, required: true, maxlength: 64 },
  lapNumber: { type: Number, required: true, min: 1 },
  splitMs: { type: Number, required: true, min: 1 },
  totalMs: { type: Number, required: true, min: 1 },
}, { timestamps: true })

lapSchema.index({ userId: 1, createdAt: -1 })
lapSchema.index({ userId: 1, sessionId: 1, lapNumber: 1 }, { unique: true })

const User = mongoose.models.User || mongoose.model('User', userSchema)
const Note = mongoose.models.Note || mongoose.model('Note', noteSchema)
const Lap = mongoose.models.Lap || mongoose.model('Lap', lapSchema)

export function isValidUsername(username) {
  return typeof username === 'string' && /^[a-z0-9_]{3,24}$/i.test(username)
}

export function isValidPassword(password) {
  return typeof password === 'string'
    && password.length >= 10
    && Buffer.byteLength(password, 'utf8') <= 72
}

export function isValidLap(lap) {
  return Boolean(lap
    && typeof lap.sessionId === 'string'
    && /^[a-z0-9-]{16,64}$/i.test(lap.sessionId)
    && Number.isSafeInteger(lap.lapNumber)
    && lap.lapNumber > 0
    && Number.isSafeInteger(lap.splitMs)
    && lap.splitMs > 0
    && Number.isSafeInteger(lap.totalMs)
    && lap.totalMs >= lap.splitMs
    && lap.totalMs <= maximumLapDuration)
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 bytes')
  }
  return secret
}

function createToken(userId) {
  return jwt.sign({ sub: String(userId) }, getJwtSecret(), {
    expiresIn: '7d',
    issuer: tokenIssuer,
  })
}

function userResponse(user) {
  return { id: String(user._id), username: user.username }
}

const authenticate = (request, response, next) => {
  const authorization = request.get('authorization') || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token) {
    logEvent('warn', 'auth.authentication_failed', { ...requestLogFields(request), reason: 'missing_token' })
    return response.status(401).json({ error: 'Sign in to continue.' })
  }

  try {
    const payload = jwt.verify(token, getJwtSecret(), { issuer: tokenIssuer })
    if (typeof payload.sub !== 'string' || !mongoose.isValidObjectId(payload.sub)) {
      logEvent('warn', 'auth.authentication_failed', { ...requestLogFields(request), reason: 'invalid_claims' })
      return response.status(401).json({ error: 'Your session is invalid. Sign in again.' })
    }
    request.userId = payload.sub
    return next()
  } catch {
    logEvent('warn', 'auth.authentication_failed', { ...requestLogFields(request), reason: 'invalid_token' })
    return response.status(401).json({ error: 'Your session has expired. Sign in again.' })
  }
}

app.set('trust proxy', 1)
app.use((request, response, next) => {
  request.requestId = randomUUID()
  response.setHeader('X-Request-Id', request.requestId)
  const startedAt = Date.now()
  let logged = false
  const logRequest = () => {
    if (logged) return
    logged = true
    const status = response.statusCode
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
    logEvent(level, 'http.request', {
      ...requestLogFields(request),
      status_code: status,
      duration_ms: Date.now() - startedAt,
      completed: response.writableEnded,
    })
  }
  response.once('finish', logRequest)
  response.once('close', logRequest)
  next()
})
app.use(helmet())
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
    return callback(new Error('This origin is not allowed.'))
  },
}))
app.use(express.json({ limit: '10kb' }))

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please try again later.' },
})

app.get('/api/health', (request, response) => {
  const connected = mongoose.connection.readyState === 1
  logEvent(connected ? 'info' : 'warn', 'health.checked', {
    ...requestLogFields(request),
    database_connected: connected,
  })
  response.status(connected ? 200 : 503).json({ status: connected ? 'ok' : 'database unavailable' })
})

app.post('/api/auth/register', authLimiter, async (request, response, next) => {
  const username = typeof request.body?.username === 'string'
    ? request.body.username.trim().toLowerCase()
    : ''
  const { password } = request.body || {}

  if (!isValidUsername(username)) {
    logEvent('warn', 'auth.registration_rejected', { ...requestLogFields(request), reason: 'invalid_username' })
    return response.status(400).json({ error: 'Username must be 3–24 letters, numbers, or underscores.' })
  }
  if (!isValidPassword(password)) {
    logEvent('warn', 'auth.registration_rejected', { ...requestLogFields(request), reason: 'invalid_password' })
    return response.status(400).json({ error: 'Password must be at least 10 characters and no more than 72 bytes.' })
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12)
    const user = await User.create({ username, passwordHash })
    logEvent('info', 'auth.registration_succeeded', {
      ...requestLogFields(request),
      user_id: String(user._id),
    })
    return response.status(201).json({ token: createToken(user._id), user: userResponse(user) })
  } catch (error) {
    if (error.code === 11000) {
      logEvent('warn', 'auth.registration_rejected', { ...requestLogFields(request), reason: 'username_taken' })
      return response.status(409).json({ error: 'That username is already taken.' })
    }
    return next(error)
  }
})

app.post('/api/auth/login', authLimiter, async (request, response, next) => {
  const username = typeof request.body?.username === 'string'
    ? request.body.username.trim().toLowerCase()
    : ''
  const { password } = request.body || {}

  if (!isValidUsername(username) || typeof password !== 'string') {
    logEvent('warn', 'auth.login_failed', { ...requestLogFields(request), reason: 'invalid_credentials' })
    return response.status(401).json({ error: 'Username or password is incorrect.' })
  }

  try {
    const user = await User.findOne({ username }).select('+passwordHash')
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      logEvent('warn', 'auth.login_failed', { ...requestLogFields(request), reason: 'invalid_credentials' })
      return response.status(401).json({ error: 'Username or password is incorrect.' })
    }
    logEvent('info', 'auth.login_succeeded', {
      ...requestLogFields(request),
      user_id: String(user._id),
    })
    return response.json({ token: createToken(user._id), user: userResponse(user) })
  } catch (error) {
    return next(error)
  }
})

app.get('/api/auth/me', authenticate, async (request, response, next) => {
  try {
    const user = await User.findById(request.userId)
    if (!user) {
      logEvent('warn', 'auth.account_missing', requestLogFields(request))
      return response.status(401).json({ error: 'Your account no longer exists.' })
    }
    return response.json({ user: userResponse(user) })
  } catch (error) {
    return next(error)
  }
})

app.get('/api/notes', authenticate, async (request, response, next) => {
  try {
    const notes = await Note.find({ userId: request.userId }).sort({ createdAt: -1 }).limit(50).lean()
    logEvent('info', 'notes.listed', { ...requestLogFields(request), count: notes.length })
    return response.json({ notes })
  } catch (error) {
    return next(error)
  }
})

app.post('/api/notes', authenticate, async (request, response, next) => {
  const text = typeof request.body?.text === 'string' ? request.body.text.trim() : ''
  if (!text || text.length > 500) {
    return response.status(400).json({ error: 'A note must contain 1–500 characters.' })
  }

  try {
    const note = await Note.create({ userId: request.userId, text })
    logEvent('info', 'notes.created', { ...requestLogFields(request), note_id: String(note._id) })
    return response.status(201).json({ note })
  } catch (error) {
    return next(error)
  }
})

app.delete('/api/notes/:id', authenticate, async (request, response, next) => {
  try {
    const note = await Note.findOneAndDelete({ _id: request.params.id, userId: request.userId })
    if (!note) {
      logEvent('warn', 'notes.delete_not_found', requestLogFields(request))
      return response.status(404).json({ error: 'Note not found.' })
    }
    logEvent('info', 'notes.deleted', { ...requestLogFields(request), note_id: String(note._id) })
    return response.json({ success: true })
  } catch (error) {
    return next(error)
  }
})

app.get('/api/laps', authenticate, async (request, response, next) => {
  try {
    const laps = await Lap.find({ userId: request.userId }).sort({ createdAt: -1 }).limit(100).lean()
    logEvent('info', 'laps.listed', { ...requestLogFields(request), count: laps.length })
    return response.json({ laps })
  } catch (error) {
    return next(error)
  }
})

app.post('/api/laps', authenticate, async (request, response, next) => {
  if (!isValidLap(request.body)) {
    return response.status(400).json({ error: 'Lap timing data is invalid.' })
  }

  try {
    const lap = await Lap.create({ ...request.body, userId: request.userId })
    logEvent('info', 'laps.created', { ...requestLogFields(request), lap_id: String(lap._id) })
    return response.status(201).json({ lap })
  } catch (error) {
    if (error.code === 11000) {
      logEvent('warn', 'laps.create_rejected', { ...requestLogFields(request), reason: 'duplicate_lap' })
      return response.status(409).json({ error: 'This lap has already been saved.' })
    }
    return next(error)
  }
})

app.delete('/api/laps/:id', authenticate, async (request, response, next) => {
  try {
    const lap = await Lap.findOneAndDelete({ _id: request.params.id, userId: request.userId })
    if (!lap) {
      logEvent('warn', 'laps.delete_not_found', requestLogFields(request))
      return response.status(404).json({ error: 'Lap not found.' })
    }
    logEvent('info', 'laps.deleted', { ...requestLogFields(request), lap_id: String(lap._id) })
    return response.json({ success: true })
  } catch (error) {
    return next(error)
  }
})

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error)
  if (error.message === 'This origin is not allowed.') {
    logEvent('warn', 'http.request_rejected', {
      ...requestLogFields(request),
      status_code: 403,
      reason: 'origin_not_allowed',
    })
    return response.status(403).json({ error: error.message })
  }
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    logEvent('warn', 'http.request_rejected', {
      ...requestLogFields(request),
      status_code: 400,
      ...errorLogFields(error),
    })
    return response.status(400).json({ error: 'Request data is invalid.' })
  }
  if (error.status === 413) {
    logEvent('warn', 'http.request_rejected', {
      ...requestLogFields(request),
      status_code: 413,
      ...errorLogFields(error),
    })
    return response.status(413).json({ error: 'Request body is too large.' })
  }
  if (error.status === 400) {
    logEvent('warn', 'http.request_rejected', {
      ...requestLogFields(request),
      status_code: 400,
      ...errorLogFields(error),
    })
    return response.status(400).json({ error: 'Request body must be valid JSON.' })
  }
  logEvent('error', 'http.request_failed', {
    ...requestLogFields(request),
    status_code: 500,
    ...errorLogFields(error),
  })
  return response.status(500).json({ error: 'Unexpected server error.' })
})

export async function start() {
  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) throw new Error('MONGODB_URI must be configured.')
  getJwtSecret()
  try {
    await mongoose.connect(mongoUri)
    logEvent('info', 'database.connected')
    await Promise.all([User.init(), Note.init(), Lap.init()])
    logEvent('info', 'database.indexes_ready')
  } catch (error) {
    logEvent('error', 'database.connection_failed', errorLogFields(error))
    throw error
  }

  const port = Number(process.env.PORT || 3001)
  return app.listen(port, () => {
    logEvent('info', 'server.started', { port })
  })
}

export { app }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  start().catch((error) => {
    logEvent('error', 'server.start_failed', errorLogFields(error))
    process.exitCode = 1
  })
}