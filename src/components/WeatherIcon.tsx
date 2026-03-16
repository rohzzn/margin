import type { WeatherCondition } from '../lib/weather'

interface WeatherIconProps {
  condition: WeatherCondition
  isDay: boolean
}

function ClearIcon({ isDay }: { isDay: boolean }) {
  if (!isDay) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M14.6 3.6a7.6 7.6 0 1 0 5.8 13.2A8.8 8.8 0 1 1 14.6 3.6Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.85"
        />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.85"
      />
      <path
        d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.85"
      />
    </svg>
  )
}

function PartlyCloudyIcon({ isDay }: { isDay: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {isDay ? (
        <>
          <circle
            cx="9"
            cy="9"
            r="3.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          />
          <path
            d="M9 3.5v1.6M9 12.9v1.6M14.5 9H12.9M5.1 9H3.5M12.8 5.2l-1.1 1.1M6.3 11.7l-1.1 1.1"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.6"
          />
        </>
      ) : (
        <path
          d="M10.9 4.4a5.7 5.7 0 1 0 4.4 9.9A6.6 6.6 0 1 1 10.9 4.4Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      )}
      <path
        d="M8 18.2h8.4a3.1 3.1 0 0 0 .1-6.2 4.5 4.5 0 0 0-8.4-1.5A3.5 3.5 0 0 0 8 18.2Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.85"
      />
    </svg>
  )
}

function CloudyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.4 18.4h9.2a3.5 3.5 0 0 0 .1-7 5.1 5.1 0 0 0-9.5-1.8 4 4 0 0 0 .2 8.8Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.85"
      />
    </svg>
  )
}

function FogIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.7 13.3h8a3 3 0 0 0 .1-6 4.4 4.4 0 0 0-8.1-1.5 3.3 3.3 0 0 0 0 7.5Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.85"
      />
      <path
        d="M5 16.8h14M7 20h10"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

function RainIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.4 13.4h9.2a3.5 3.5 0 0 0 .1-7 5.1 5.1 0 0 0-9.5-1.8 4 4 0 0 0 .2 8.8Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.85"
      />
      <path
        d="M9 16.6 8.1 19M12.7 16.6 11.8 19M16.4 16.6 15.5 19"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.85"
      />
    </svg>
  )
}

function SnowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.4 13.1h9.2a3.5 3.5 0 0 0 .1-7 5.1 5.1 0 0 0-9.5-1.8 4 4 0 0 0 .2 8.8Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.85"
      />
      <path
        d="M9.1 17.2h.01M12 18.5h.01M14.9 17.2h.01"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.8"
      />
    </svg>
  )
}

function ThunderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.4 12.9h9.2a3.5 3.5 0 0 0 .1-7 5.1 5.1 0 0 0-9.5-1.8 4 4 0 0 0 .2 8.8Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.85"
      />
      <path
        d="m12.6 13.8-2 3.5h1.9l-1.1 3.2 3.1-4.4h-1.8l1.4-2.3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

export function WeatherIcon({ condition, isDay }: WeatherIconProps) {
  switch (condition) {
    case 'clear':
      return <ClearIcon isDay={isDay} />
    case 'partly-cloudy':
      return <PartlyCloudyIcon isDay={isDay} />
    case 'fog':
      return <FogIcon />
    case 'rain':
      return <RainIcon />
    case 'snow':
      return <SnowIcon />
    case 'thunder':
      return <ThunderIcon />
    case 'cloudy':
    default:
      return <CloudyIcon />
  }
}
