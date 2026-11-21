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
  const [durationInput, setDurationInput] = useState({ minutes: '05', seconds: '00' })
  const [timer, setTimer] = useState({ remaining: 300, endsAt: null, running: false })
  const [alert, setAlert] = useState('')
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement))
  const [focusMode, setFocusMode] = useState(null)
  const lastAlarmMinute = useRef('')
  const clockDisplay = formatClock(now, is24Hour)

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
    const numericValue = value.replace(/\D/g, '').slice(0, 2) || '0'
    const next = {
      ...durationInput,
      [field]: field === 'seconds'
        ? String(Math.min(59, Number(numericValue))).padStart(2, '0')
        : numericValue,
    }
    setDurationInput(next)
    if (!timer.running) {
      setTimer((current) => ({
        ...current,
        remaining: Number(next.minutes) * 60 + Number(next.seconds),
        endsAt: null,
      }))
    }
  }

  const startTimer = () => {
    stopAlarmSound()
    const seconds = timer.remaining > 0
      ? timer.remaining
      : Number(durationInput.minutes) * 60 + Number(durationInput.seconds)
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
    const seconds = Number(durationInput.minutes) * 60 + Number(durationInput.seconds)
    setTimer({ remaining: seconds, endsAt: null, running: false })
    setAlert('')
  }

  useEffect(() => {
    if (!focusMode) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setFocusMode(null)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusMode])

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
                  <span className="sr-only">Minutes</span>
                  <input
                    aria-label="Timer minutes"
                    inputMode="numeric"
                    max="99"
                    min="0"
                    onChange={(event) => updateDuration('minutes', event.target.value)}
                    onFocus={(event) => event.target.select()}
                    type="text"
                    value={String(durationInput.minutes).padStart(2, '0')}
                  />
                  <span>MIN</span>
                </label>
                <span className="timer-input-colon">:</span>
                <label>
                  <span className="sr-only">Seconds</span>
                  <input
                    aria-label="Timer seconds"
                    inputMode="numeric"
                    max="59"
                    min="0"
                    onChange={(event) => updateDuration('seconds', event.target.value)}
                    onFocus={(event) => event.target.select()}
                    type="text"
                    value={String(durationInput.seconds).padStart(2, '0')}
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
    </main>
  )
}

export default App
