import { useEffect, useRef, useState } from 'react'
import './App.css'

const initialAlarms = () => {
  try {
    return JSON.parse(localStorage.getItem('still-alarms') || '[]')
  } catch {
    return []
  }
}

function Icon({ name, size = 18 }) {
  const paths = {
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
    moon: <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />,
    expand: <><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" /></>,
    play: <path d="m8 5 12 7-12 7z" />,
    pause: <><path d="M8 5h3v14H8zM15 5h3v14h-3z" /></>,
    reset: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

function formatTime(date, is24Hour) {
  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 2,
    hour12: !is24Hour,
  }).format(date)
  return time
}

function formatClock(date, is24Hour) {
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !is24Hour,
  }).formatToParts(date)
  const centiseconds = String(Math.floor(date.getMilliseconds() / 10)).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')

  return {
    time: `${parts.filter((part) => part.type !== 'dayPeriod').map((part) => part.value).join('')}:${seconds}`,
    centiseconds,
    period: parts.find((part) => part.type === 'dayPeriod')?.value || '',
  }
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, '0')).join(':')
}

function durationInSeconds(duration) {
  return Number(duration.hours || 0) * 3600
    + Number(duration.minutes || 0) * 60
    + Number(duration.seconds || 0)
}

function formatStopwatch(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const centiseconds = Math.floor((milliseconds % 1000) / 10)
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
    + `.${String(centiseconds).padStart(2, '0')}`
}

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

async function apiRequest(path, { token, method = 'GET', body } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${API_BASE_URL}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) {
    const error = new Error(result.error || 'The request could not be completed.')
    error.status = response.status
    throw error
  }
  return result
}

let activeAlarmContext = null
let activeAlarmNodes = []

function stopAlarmSound() {
  activeAlarmNodes.forEach((node) => {
    try {
      node.stop()
    } catch {
      // The oscillator may already have stopped naturally.
    }
  })
  activeAlarmNodes = []

  if (activeAlarmContext) {
    activeAlarmContext.close()
    activeAlarmContext = null
  }
}

function playAlarmSound() {
  stopAlarmSound()

  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return

  const context = new AudioContextClass()
  activeAlarmContext = context

  if (context.state === 'suspended') {
    context.resume()
  }

  const schedulePulse = (start, frequency, duration) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, start)
    oscillator.frequency.linearRampToValueAtTime(frequency * 1.04, start + duration)

    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.025)
    gain.gain.setValueAtTime(0.18, start + duration - 0.08)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(start)
    oscillator.stop(start + duration)
    activeAlarmNodes.push(oscillator)
  }

  for (let cycle = 0; cycle < 10; cycle += 1) {
    const start = context.currentTime + cycle * 2.2
    schedulePulse(start, 880, 0.22)
    schedulePulse(start + 0.28, 880, 0.22)
    schedulePulse(start + 0.56, 880, 0.22)
    schedulePulse(start + 1.05, 660, 0.52)
  }

  const lastOscillator = activeAlarmNodes[activeAlarmNodes.length - 1]
  if (lastOscillator) {
    lastOscillator.onended = () => {
      activeAlarmNodes = []
      activeAlarmContext = null
      context.close()
    }
  }
}

function App() {
  const [now, setNow] = useState(() => new Date())
  const [is24Hour, setIs24Hour] = useState(true)
  const [theme, setTheme] = useState(() => localStorage.getItem('still-theme') || 'dark')
  const [alarms, setAlarms] = useState(initialAlarms)
  const [alarmTime, setAlarmTime] = useState('')
  const [alarmLabel, setAlarmLabel] = useState('')
  const [repeatAlarm, setRepeatAlarm] = useState(false)
  const [durationInput, setDurationInput] = useState({ hours: '00', minutes: '05', seconds: '00' })
  const [timer, setTimer] = useState({ remaining: 300, endsAt: null, running: false })
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('still-auth-token') || '')
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(() => Boolean(localStorage.getItem('still-auth-token')))
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authForm, setAuthForm] = useState({ username: '', password: '' })
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [accountError, setAccountError] = useState('')
  const [notes, setNotes] = useState([])
  const [noteDraft, setNoteDraft] = useState('')
  const [noteBusy, setNoteBusy] = useState(false)
  const [notesError, setNotesError] = useState('')
  const [laps, setLaps] = useState([])
  const [lapBusy, setLapBusy] = useState(false)
  const [lapsError, setLapsError] = useState('')
  const [stopwatch, setStopwatch] = useState({
    elapsedMs: 0,
    startedAt: null,
    running: false,
    sessionId: null,
    lastLapMs: 0,
    lapNumber: 0,
  })
  const [alert, setAlert] = useState('')
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement))
  const [focusMode, setFocusMode] = useState(null)
  const lastAlarmMinute = useRef('')
  const clockDisplay = formatClock(now, is24Hour)

  const expireSession = (error) => {
    localStorage.removeItem('still-auth-token')
    setAuthToken('')
    setUser(null)
    setNotes([])
    setLaps([])
    setAuthLoading(false)
    setAuthMode('login')
    setAuthOpen(true)
    setAuthError(error.message)
  }

  const handlePrivateRequestError = (error, setError) => {
    setError(error.message)
    if (error.status === 401) expireSession(error)
  }

  const hasCurrentSession = () => (
    Boolean(authToken) && localStorage.getItem('still-auth-token') === authToken
  )

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 16)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('still-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('still-alarms', JSON.stringify(alarms))
  }, [alarms])

  useEffect(() => {
    if (!authToken) return undefined

    let active = true

    const loadAccount = async () => {
      try {
        const account = await apiRequest('/auth/me', { token: authToken })
        if (!active) return
        setUser(account.user)

        const [noteResult, lapResult] = await Promise.allSettled([
          apiRequest('/notes', { token: authToken }),
          apiRequest('/laps', { token: authToken }),
        ])
        if (!active) return
        if (noteResult.status === 'fulfilled') {
          setNotes(noteResult.value.notes)
          setNotesError('')
        } else {
          setNotesError(noteResult.reason.message)
        }
        if (lapResult.status === 'fulfilled') {
          setLaps(lapResult.value.laps)
          setLapsError('')
        } else {
          setLapsError(lapResult.reason.message)
        }
      } catch (error) {
        if (!active) return
        setAccountError(error.message)
        if (error.status === 401) expireSession(error)
      } finally {
        if (active) setAuthLoading(false)
      }
    }

    loadAccount()
    return () => {
      active = false
    }
  }, [authToken])

  useEffect(() => {
    if (!timer.running || !timer.endsAt) return undefined

    const updateTimer = () => {
      const remaining = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000))
      if (remaining === 0) {
        setTimer({ remaining: 0, endsAt: null, running: false })
        setAlert('Timer complete')
        playAlarmSound()
      } else {
        setTimer((current) => ({ ...current, remaining }))
      }
    }

    const interval = window.setInterval(updateTimer, 200)
    return () => window.clearInterval(interval)
  }, [timer.running, timer.endsAt])

  useEffect(() => {
    const interval = window.setInterval(() => {
      const currentTime = new Date()
      if (currentTime.getSeconds() !== 0) return

      const time = `${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`
      const minuteKey = `${currentTime.toDateString()} ${time}`
      if (lastAlarmMinute.current === minuteKey) return

      const dueAlarm = alarms.find((alarm) => alarm.enabled && alarm.time === time)
      if (!dueAlarm) return

      lastAlarmMinute.current = minuteKey
      setAlert(dueAlarm.label || 'Alarm')
      playAlarmSound()
      if (!dueAlarm.repeat) {
        setAlarms((current) => current.map((alarm) => (
          alarm.id === dueAlarm.id ? { ...alarm, enabled: false } : alarm
        )))
      }
    }, 250)

    return () => window.clearInterval(interval)
  }, [alarms])

  useEffect(() => {
    const handleFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const dateLabel = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now)

  const handleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await document.documentElement.requestFullscreen()
    }
  }

  const updateDuration = (field, value) => {
    const next = { ...durationInput, [field]: value.replace(/\D/g, '').slice(0, 2) }
    setDurationInput(next)
    if (!timer.running) {
      setTimer((current) => ({
        ...current,
        remaining: durationInSeconds(next),
        endsAt: null,
      }))
    }
  }

  const normalizeDuration = (field) => {
    const limit = field === 'seconds' ? 59 : 99
    const value = String(Math.min(limit, Number(durationInput[field] || 0))).padStart(2, '0')
    const next = { ...durationInput, [field]: value }
    setDurationInput(next)
    if (!timer.running) {
      setTimer((current) => ({
        ...current,
        remaining: durationInSeconds(next),
        endsAt: null,
      }))
    }
  }

  const startTimer = () => {
    stopAlarmSound()
    const seconds = timer.remaining > 0
      ? timer.remaining
      : durationInSeconds(durationInput)
    if (seconds <= 0) return
    setAlert('')
    setTimer({ remaining: seconds, endsAt: Date.now() + seconds * 1000, running: true })
  }

  const pauseTimer = () => {
    const remaining = timer.endsAt ? Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000)) : timer.remaining
    setTimer({ remaining, endsAt: null, running: false })
  }

  const resetTimer = () => {
    stopAlarmSound()
    const seconds = durationInSeconds(durationInput)
    setTimer({ remaining: seconds, endsAt: null, running: false })
    setAlert('')
  }

  const openAuth = (mode = 'login') => {
    setAuthMode(mode)
    setAuthError('')
    setAccountError('')
    setAuthOpen(true)
  }

  const submitAuth = async (event) => {
    event.preventDefault()
    setAuthBusy(true)
    setAuthError('')
    try {
      const result = await apiRequest(`/auth/${authMode}`, {
        method: 'POST',
        body: authForm,
      })
      localStorage.setItem('still-auth-token', result.token)
      setAuthLoading(true)
      setAuthToken(result.token)
      setUser(result.user)
      setAuthForm({ username: '', password: '' })
      setAuthOpen(false)
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setAuthBusy(false)
    }
  }

  const signOut = () => {
    localStorage.removeItem('still-auth-token')
    setAuthToken('')
    setUser(null)
    setNotes([])
    setLaps([])
    setAuthLoading(false)
    setAuthOpen(false)
    setAccountError('')
    setAuthError('')
  }

  const saveNote = async (event) => {
    event.preventDefault()
    const text = noteDraft.trim()
    if (!text || !authToken) return

    setNoteBusy(true)
    setNotesError('')
    try {
      const result = await apiRequest('/notes', {
        token: authToken,
        method: 'POST',
        body: { text },
      })
      if (!hasCurrentSession()) return
      setNotes((current) => [result.note, ...current])
      setNoteDraft('')
    } catch (error) {
      handlePrivateRequestError(error, setNotesError)
    } finally {
      setNoteBusy(false)
    }
  }

  const deleteNote = async (noteId) => {
    setNotesError('')
    try {
      await apiRequest(`/notes/${encodeURIComponent(noteId)}`, {
        token: authToken,
        method: 'DELETE',
      })
      if (!hasCurrentSession()) return
      setNotes((current) => current.filter((note) => note._id !== noteId))
    } catch (error) {
      handlePrivateRequestError(error, setNotesError)
    }
  }

  const startStopwatch = () => {
    const sessionId = stopwatch.sessionId || crypto.randomUUID()
    setStopwatch((current) => ({
      ...current,
      startedAt: Date.now() - current.elapsedMs,
      sessionId,
      running: true,
    }))
  }

  const pauseStopwatch = () => {
    setStopwatch((current) => ({
      ...current,
      elapsedMs: Date.now() - current.startedAt,
      startedAt: null,
      running: false,
    }))
  }

  const resetStopwatch = () => {
    setStopwatch({
      elapsedMs: 0,
      startedAt: null,
      running: false,
      sessionId: null,
      lastLapMs: 0,
      lapNumber: 0,
    })
  }

  const recordLap = async () => {
    if (!user) {
      openAuth('login')
      return
    }
    if (!stopwatch.running || lapBusy) return

    const totalMs = Date.now() - stopwatch.startedAt
    const lapNumber = stopwatch.lapNumber + 1
    const lap = {
      sessionId: stopwatch.sessionId,
      lapNumber,
      totalMs,
      splitMs: totalMs - stopwatch.lastLapMs,
    }

    setLapBusy(true)
    setLapsError('')
    try {
      const result = await apiRequest('/laps', {
        token: authToken,
        method: 'POST',
        body: lap,
      })
      if (!hasCurrentSession()) return
      setLaps((current) => [result.lap, ...current].slice(0, 100))
      setStopwatch((current) => current.sessionId === lap.sessionId
        ? { ...current, lastLapMs: totalMs, lapNumber }
        : current)
    } catch (error) {
      handlePrivateRequestError(error, setLapsError)
    } finally {
      setLapBusy(false)
    }
  }

  const deleteLap = async (lapId) => {
    setLapsError('')
    try {
      await apiRequest(`/laps/${encodeURIComponent(lapId)}`, {
        token: authToken,
        method: 'DELETE',
      })
      if (!hasCurrentSession()) return
      setLaps((current) => current.filter((lap) => lap._id !== lapId))
    } catch (error) {
      handlePrivateRequestError(error, setLapsError)
    }
  }

  useEffect(() => {
    if (!focusMode) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setFocusMode(null)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusMode])

  useEffect(() => {
    if (!authOpen) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setAuthOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [authOpen])

  useEffect(() => {
    if (!stopwatch.running) return undefined

    const interval = window.setInterval(() => {
      setStopwatch((current) => current.running
        ? { ...current, elapsedMs: Date.now() - current.startedAt }
        : current)
    }, 25)
    return () => window.clearInterval(interval)
  }, [stopwatch.running])

  const addAlarm = (event) => {
    event.preventDefault()
    if (!alarmTime) return
    setAlarms((current) => [...current, {
      id: `${Date.now()}-${Math.random()}`,
      time: alarmTime,
      label: alarmLabel.trim() || 'Wake up',
      repeat: repeatAlarm,
      enabled: true,
    }].sort((a, b) => a.time.localeCompare(b.time)))
    setAlarmTime('')
    setAlarmLabel('')
    setRepeatAlarm(false)
  }

  if (focusMode) {
    return (
      <main className="focus-screen">
        <button
          type="button"
          className="focus-exit"
          aria-label="Exit focus mode"
          title="Exit focus mode (Esc)"
          onClick={() => setFocusMode(null)}
        >
          <Icon name="close" size={20} />
        </button>
        <div className="focus-content">
          {focusMode === 'clock' ? (
            <div className="focus-clock" aria-label={`Current time ${formatTime(now, is24Hour)}`}>
              <span>{clockDisplay.time}</span>
              <sup className="focus-centiseconds">{clockDisplay.centiseconds}</sup>
              {clockDisplay.period && <span className="focus-period">{clockDisplay.period}</span>}
            </div>
          ) : (
            <>
              <div className={`focus-timer ${timer.running ? 'focus-timer-active' : ''}`} role="timer">
                {formatDuration(timer.remaining)}
              </div>
              <div className="focus-timer-actions">
                <button className="focus-control focus-control-primary" type="button" onClick={timer.running ? pauseTimer : startTimer}>
                  <Icon name={timer.running ? 'pause' : 'play'} size={16} />
                  {timer.running ? 'Pause' : timer.remaining === 0 ? 'Start again' : 'Start'}
                </button>
                <button className="focus-control" type="button" aria-label="Reset timer" onClick={resetTimer}>
                  <Icon name="reset" size={16} />
                  Reset
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Still home">
          <span className="brand-mark"><span /></span>
          <span>still<span className="brand-period">.</span></span>
        </a>
        <div className="topbar-right">
          <span className="live-indicator"><span /> LOCAL TIME</span>
          {authLoading ? (
            <span className="account-loading">ACCOUNT</span>
          ) : user ? (
            <div className="account-actions">
              <span className="account-name">{user.username}</span>
              <button type="button" className="account-button" onClick={signOut}>Sign out</button>
            </div>
          ) : (
            <button type="button" className="account-button" onClick={() => openAuth('login')}>Sign in</button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            onClick={handleFullscreen}
          >
            <Icon name="expand" />
          </button>
        </div>
      </header>

      <section className="dashboard">
        <div className="clock-column">
          <div className="eyebrow"><span className="eyebrow-line" /> A LITTLE SPACE, JUST FOR YOU</div>
          <div className="clock-display">
            <div className="time-row" aria-label={`Current time ${formatTime(now, is24Hour)}`}>
              <span className="time-value">{clockDisplay.time}</span>
              <sup className="time-centiseconds">{clockDisplay.centiseconds}</sup>
              {clockDisplay.period && <span className="time-period">{clockDisplay.period}</span>}
            </div>
            <div className="date-row">
              <span className="date-dot" />
              <span>{dateLabel}</span>
              <span className="date-divider" />
              <span>{Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_', ' ')}</span>
            </div>
          </div>

          <div className="clock-face" aria-hidden="true">
            <div className="clock-face-inner">
              {[...Array(12)].map((_, index) => (
                <span
                  className={`clock-tick ${index % 3 === 0 ? 'clock-tick-major' : ''}`}
                  key={index}
                  style={{ transform: `rotate(${index * 30}deg)` }}
                />
              ))}
              <span className="clock-hand clock-hand-hour" style={{ transform: `rotate(${now.getHours() % 12 * 30 + now.getMinutes() / 2}deg)` }} />
              <span className="clock-hand clock-hand-minute" style={{ transform: `rotate(${now.getMinutes() * 6 + now.getSeconds() / 10}deg)` }} />
              <span className="clock-hand clock-hand-second" style={{ transform: `rotate(${now.getSeconds() * 6}deg)` }} />
              <span className="clock-pin" />
            </div>
            <span className="clock-caption">A MOMENT AT A TIME</span>
          </div>

          <button className="format-button" type="button" onClick={() => setIs24Hour(!is24Hour)}>
            <span className={is24Hour ? 'format-option selected' : 'format-option'}>24H</span>
            <span className="format-separator">/</span>
            <span className={!is24Hour ? 'format-option selected' : 'format-option'}>12H</span>
          </button>
          <button className="focus-launch" type="button" onClick={() => setFocusMode('clock')}>
            <Icon name="expand" size={13} />
            Focus clock
          </button>
        </div>

        <div className="tools-column">
          <section className="tool-card timer-card">
            <div className="card-heading">
              <div className="card-title-wrap">
                <span className="card-index">01</span>
                <div>
                  <h2>Timer</h2>
                  <p className="card-subtitle">A little focus goes a long way.</p>
                </div>
              </div>
              <div className="timer-heading-actions">
                <span className={`status-dot ${timer.running ? 'status-active' : ''}`} title={timer.running ? 'Timer running' : 'Timer stopped'} />
                <button
                  type="button"
                  className="icon-button focus-card-button"
                  aria-label="Focus timer"
                  title="Focus timer"
                  onClick={() => setFocusMode('timer')}
                >
                  <Icon name="expand" size={15} />
                </button>
              </div>
            </div>

            <div className={`timer-readout ${timer.running ? 'timer-readout-active' : ''}`}>
              {formatDuration(timer.remaining)}
            </div>
            {!timer.running && (
              <div className="timer-inputs">
                <label>
                  <span className="sr-only">Hours</span>
                  <input
                    aria-label="Timer hours"
                    inputMode="numeric"
                    maxLength="2"
                    onChange={(event) => updateDuration('hours', event.target.value)}
                    onFocus={(event) => event.target.select()}
                    onBlur={() => normalizeDuration('hours')}
                    type="text"
                    value={durationInput.hours}
                  />
                  <span>HR</span>
                </label>
                <span className="timer-input-colon">:</span>
                <label>
                  <span className="sr-only">Minutes</span>
                  <input
                    aria-label="Timer minutes"
                    inputMode="numeric"
                    maxLength="2"
                    onChange={(event) => updateDuration('minutes', event.target.value)}
                    onFocus={(event) => event.target.select()}
                    onBlur={() => normalizeDuration('minutes')}
                    type="text"
                    value={durationInput.minutes}
                  />
                  <span>MIN</span>
                </label>
                <span className="timer-input-colon">:</span>
                <label>
                  <span className="sr-only">Seconds</span>
                  <input
                    aria-label="Timer seconds"
                    inputMode="numeric"
                    maxLength="2"
                    onChange={(event) => updateDuration('seconds', event.target.value)}
                    onFocus={(event) => event.target.select()}
                    onBlur={() => normalizeDuration('seconds')}
                    type="text"
                    value={durationInput.seconds}
                  />
                  <span>SEC</span>
                </label>
              </div>
            )}

            <div className="timer-actions">
              {timer.running ? (
                <button className="primary-button" type="button" onClick={pauseTimer}>
                  <Icon name="pause" size={16} /> Pause
                </button>
              ) : (
                <button className="primary-button" type="button" onClick={startTimer}>
                  <Icon name="play" size={15} /> {timer.remaining === 0 ? 'Start again' : 'Start timer'}
                </button>
              )}
              <button className="secondary-button" type="button" onClick={resetTimer} aria-label="Reset timer">
                <Icon name="reset" size={16} />
              </button>
              {timer.running && <button className="secondary-button" type="button" onClick={resetTimer}>Reset</button>}
            </div>
          </section>

          <section className="tool-card alarm-card">
            <div className="card-heading">
              <div className="card-title-wrap">
                <span className="card-index">02</span>
                <div>
                  <h2>Alarm</h2>
                  <p className="card-subtitle">Be here when it matters.</p>
                </div>
              </div>
              <span className="alarm-count">{alarms.filter((alarm) => alarm.enabled).length} ON</span>
            </div>

            <form className="alarm-form" onSubmit={addAlarm}>
              <label className="alarm-time-input">
                <span className="sr-only">Alarm time</span>
                <input required type="time" value={alarmTime} onChange={(event) => setAlarmTime(event.target.value)} />
              </label>
              <label className="alarm-name-input">
                <span className="sr-only">Alarm label</span>
                <input maxLength="24" placeholder="Give it a name" type="text" value={alarmLabel} onChange={(event) => setAlarmLabel(event.target.value)} />
              </label>
              <button className="add-alarm-button" type="submit" aria-label="Add alarm">
                <Icon name="plus" size={18} />
              </button>
            </form>

            <label className="repeat-option">
              <input checked={repeatAlarm} type="checkbox" onChange={(event) => setRepeatAlarm(event.target.checked)} />
              <span className="custom-checkbox"><Icon name="check" size={12} /></span>
              <span>Repeat every day</span>
            </label>

            {alarms.length > 0 ? (
              <ul className="alarm-list">
                {alarms.map((alarm) => (
                  <li className={`alarm-item ${alarm.enabled ? '' : 'alarm-disabled'}`} key={alarm.id}>
                    <span className="alarm-item-time">{alarm.time}</span>
                    <span className="alarm-item-label">{alarm.label}<small>{alarm.repeat ? 'Every day' : 'Once'}</small></span>
                    <button
                      type="button"
                      className={`toggle-switch ${alarm.enabled ? 'toggle-on' : ''}`}
                      role="switch"
                      aria-checked={alarm.enabled}
                      aria-label={`${alarm.enabled ? 'Disable' : 'Enable'} ${alarm.label} alarm`}
                      onClick={() => setAlarms((current) => current.map((item) => item.id === alarm.id ? { ...item, enabled: !item.enabled } : item))}
                    >
                      <span />
                    </button>
                    <button type="button" className="remove-alarm" aria-label={`Remove ${alarm.label} alarm`} onClick={() => setAlarms((current) => current.filter((item) => item.id !== alarm.id))}>
                      <Icon name="close" size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-alarms">No alarms set yet <span>·</span> add one above</p>
            )}
          </section>

          <section className="tool-card stopwatch-card">
            <div className="card-heading">
              <div className="card-title-wrap">
                <span className="card-index">03</span>
                <div>
                  <h2>Stopwatch</h2>
                  <p className="card-subtitle">Track time in split laps.</p>
                </div>
              </div>
              <span className={`status-dot ${stopwatch.running ? 'status-active' : ''}`} title={stopwatch.running ? 'Stopwatch running' : 'Stopwatch stopped'} />
            </div>

            <div className={`stopwatch-readout ${stopwatch.running ? 'timer-readout-active' : ''}`} role="timer">
              {formatStopwatch(stopwatch.elapsedMs)}
            </div>
            <div className="stopwatch-actions">
              <button className="primary-button" type="button" onClick={stopwatch.running ? pauseStopwatch : startStopwatch}>
                <Icon name={stopwatch.running ? 'pause' : 'play'} size={15} />
                {stopwatch.running ? 'Pause' : 'Start'}
              </button>
              <button className="secondary-button" type="button" onClick={recordLap} disabled={!stopwatch.running || lapBusy}>
                {lapBusy ? 'Saving…' : 'Lap'}
              </button>
              <button className="secondary-button" type="button" onClick={resetStopwatch} aria-label="Reset stopwatch">
                <Icon name="reset" size={16} />
              </button>
            </div>
            {!user && (
              <p className="account-prompt">
                <button type="button" className="text-button" onClick={() => openAuth('login')}>Sign in</button>
                {' '}to save laps.
              </p>
            )}
            {lapsError && <p className="form-error" role="alert">{lapsError}</p>}
            {user && (
              <ul className="saved-lap-list" aria-label="Saved stopwatch laps">
                {laps.length ? laps.slice(0, 10).map((lap) => (
                  <li className="saved-lap-item" key={lap._id}>
                    <span className="saved-lap-number">LAP {lap.lapNumber}</span>
                    <span className="saved-lap-times">
                      {formatStopwatch(lap.splitMs)}
                      <small>TOTAL {formatStopwatch(lap.totalMs)}</small>
                    </span>
                    <button
                      type="button"
                      className="remove-alarm"
                      aria-label={`Delete lap ${lap.lapNumber}`}
                      onClick={() => deleteLap(lap._id)}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </li>
                )) : <li className="empty-data">No saved laps yet.</li>}
              </ul>
            )}
          </section>

          <section className="tool-card notes-card">
            <div className="card-heading">
              <div className="card-title-wrap">
                <span className="card-index">04</span>
                <div>
                  <h2>Short notes</h2>
                  <p className="card-subtitle">Keep a thought close at hand.</p>
                </div>
              </div>
            </div>

            {authLoading ? (
              <p className="empty-data">Checking your account…</p>
            ) : user ? (
              <>
                <form className="note-form" onSubmit={saveNote}>
                  <label className="sr-only" htmlFor="note-draft">Write a short note</label>
                  <textarea
                    id="note-draft"
                    maxLength="500"
                    placeholder="Write a short note…"
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                  />
                  <div className="note-form-footer">
                    <span>{noteDraft.length}/500</span>
                    <button className="primary-button" type="submit" disabled={noteBusy || !noteDraft.trim()}>
                      {noteBusy ? 'Saving…' : 'Save note'}
                    </button>
                  </div>
                </form>
                {notesError && <p className="form-error" role="alert">{notesError}</p>}
                <ul className="saved-note-list" aria-label="Saved notes">
                  {notes.length ? notes.map((note) => (
                    <li className="saved-note-item" key={note._id}>
                      <p>{note.text}</p>
                      <time dateTime={note.createdAt}>
                        {new Date(note.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </time>
                      <button
                        type="button"
                        className="remove-alarm"
                        aria-label="Delete note"
                        onClick={() => deleteNote(note._id)}
                      >
                        <Icon name="close" size={15} />
                      </button>
                    </li>
                  )) : <li className="empty-data">No saved notes yet.</li>}
                </ul>
              </>
            ) : (
              <div className="account-prompt notes-prompt">
                <p>Sign in to save notes and keep them private to your account.</p>
                {accountError && <p className="form-error" role="alert">{accountError}</p>}
                <button type="button" className="primary-button" onClick={() => openAuth('login')}>
                  Sign in or create account
                </button>
              </div>
            )}
          </section>
        </div>
      </section>

      <footer className="footer">
        <span>TAKE YOUR TIME.</span>
        <span className="footer-center"><span /> DESIGNED FOR THE PRESENT</span>
        <span>STILL® &nbsp;·&nbsp; {now.getFullYear()}</span>
      </footer>

      {alert && (
        <div className="alert-toast" role="status">
          <span className="alert-pulse" />
          <span>{alert}</span>
          <button type="button" aria-label="Dismiss alert" onClick={() => {
            stopAlarmSound()
            setAlert('')
          }}><Icon name="close" size={16} /></button>
        </div>
      )}

      {authOpen && (
        <div className="auth-overlay" onClick={(event) => {
          if (event.target === event.currentTarget) setAuthOpen(false)
        }}>
          <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <button type="button" className="auth-close" aria-label="Close sign-in dialog" onClick={() => setAuthOpen(false)}>
              <Icon name="close" size={18} />
            </button>
            <span className="eyebrow"><span className="eyebrow-line" /> YOUR SPACE</span>
            <h2 id="auth-title">{authMode === 'login' ? 'Welcome back.' : 'Create your account.'}</h2>
            <p className="card-subtitle">
              {authMode === 'login' ? 'Sign in to access your notes and laps.' : 'Your notes and laps stay linked to your account.'}
            </p>
            <form className="auth-form" onSubmit={submitAuth}>
              <label>
                Username
                <input
                  autoComplete="username"
                  autoFocus
                  maxLength="24"
                  minLength="3"
                  pattern="[A-Za-z0-9_]+"
                  required
                  value={authForm.username}
                  onChange={(event) => setAuthForm((current) => ({ ...current, username: event.target.value }))}
                />
              </label>
              <label>
                Password
                <input
                  autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  maxLength="72"
                  minLength="10"
                  required
                  type="password"
                  value={authForm.password}
                  onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                />
              </label>
              {authError && <p className="form-error" role="alert">{authError}</p>}
              <button className="primary-button auth-submit" type="submit" disabled={authBusy}>
                {authBusy ? 'Please wait…' : authMode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>
            <p className="auth-switch">
              {authMode === 'login' ? 'New here?' : 'Already have an account?'}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setAuthMode(authMode === 'login' ? 'register' : 'login')
                  setAuthError('')
                }}
              >
                {authMode === 'login' ? 'Create account' : 'Sign in'}
              </button>
            </p>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
