import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { anilistServiceProbe } from '../services/anilist/client'
import { malServiceProbe } from '../services/mal/client'

export type ServiceKey = 'anilist' | 'mal'

export interface ServiceDownInfo {
  service: ServiceKey
  /** Operator's outage message when the service itself announced it. */
  reason: string | null
  since: number
}

type ServiceStatus = { anilist: ServiceDownInfo | null; mal: ServiceDownInfo | null }

interface ServiceStatusContextValue extends ServiceStatus {
  /** Probe a service immediately (the down page's "Reconnect now"). */
  recheckNow: (service: ServiceKey) => void
}

const ServiceStatusContext = createContext<ServiceStatusContextValue>({
  anilist: null,
  mal: null,
  recheckNow: () => {},
})

// Self-heal cadence while a service is believed down: probe quickly at
// first, then back off, then hold steady. Every cadence step is far past the
// point of being noisy (the probe is a single tiny fetch).
const PROBE_CADENCE_MS = [30_000, 60_000, 120_000, 300_000, 480_000]

export function ServiceStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ServiceStatus>({ anilist: null, mal: null })
  const probeTimer = useRef<Partial<Record<ServiceKey, ReturnType<typeof setTimeout>>>>({})
  const cadence = useRef<Partial<Record<ServiceKey, number>>>({})

  const clearTimer = useCallback((service: ServiceKey) => {
    const t = probeTimer.current[service]
    if (t) clearTimeout(t)
    probeTimer.current[service] = undefined
    cadence.current[service] = undefined
  }, [])

  const runProbe = useCallback(
    (service: ServiceKey) => {
      const alive = service === 'anilist' ? anilistServiceProbe() : malServiceProbe()
      alive
        .then((ok) => {
          if (ok) {
            // The client's success path has already raised the up event;
            // confirm the context clears either way.
            setStatus((s) => (s[service] ? { ...s, [service]: null } : s))
            clearTimer(service)
            return
          }
          const step = cadence.current[service] ?? 0
          const delay = PROBE_CADENCE_MS[Math.min(step, PROBE_CADENCE_MS.length - 1)]
          cadence.current[service] = Math.min(step + 1, PROBE_CADENCE_MS.length - 1)
          probeTimer.current[service] = setTimeout(() => runProbe(service), delay)
        })
        .catch(() => {})
    },
    [clearTimer],
  )

  useEffect(() => {
    const onDown = (e: Event) => {
      const detail = (e as CustomEvent)?.detail ?? {}
      const service = detail?.service as ServiceKey
      if (service !== 'anilist' && service !== 'mal') return
      setStatus((s) =>
        s[service]
          ? s
          : { ...s, [service]: { service, reason: typeof detail.reason === 'string' ? detail.reason : null, since: Date.now() } },
      )
      // Start (or restart) the self-heal cadence for this service.
      clearTimer(service)
      cadence.current[service] = 0
      probeTimer.current[service] = setTimeout(() => runProbe(service), 15_000)
    }
    const onUp = (e: Event) => {
      const detail = (e as CustomEvent)?.detail ?? {}
      const service = detail?.service as ServiceKey
      if (service !== 'anilist' && service !== 'mal') return
      setStatus((s) => (s[service] ? { ...s, [service]: null } : s))
      clearTimer(service)
    }
    window.addEventListener('aeri:service-down', onDown)
    window.addEventListener('aeri:service-up', onUp)
    return () => {
      window.removeEventListener('aeri:service-down', onDown)
      window.removeEventListener('aeri:service-up', onUp)
      clearTimer('anilist')
      clearTimer('mal')
    }
  }, [clearTimer, runProbe])

  const recheckNow = useCallback(
    (service: ServiceKey) => {
      clearTimer(service)
      runProbe(service)
    },
    [clearTimer, runProbe],
  )

  const value: ServiceStatusContextValue = { ...status, recheckNow }
  return <ServiceStatusContext.Provider value={value}>{children}</ServiceStatusContext.Provider>
}

export function useServiceStatus(): ServiceStatusContextValue {
  return useContext(ServiceStatusContext)
}
