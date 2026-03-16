export type WeatherCondition =
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'thunder'

export interface WeatherSnapshot {
  condition: WeatherCondition
  label: string
  isDay: boolean
  weatherCode: number
  fetchedAt: number
}

interface CachedWeatherSnapshot extends WeatherSnapshot {
  latitude: number
  longitude: number
}

interface WeatherApiResponse {
  current?: {
    weather_code?: number
    is_day?: number
  }
}

const WEATHER_CACHE_KEY = 'margin-reader-weather:v1'
export const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000

function roundCoordinate(value: number) {
  return Math.round(value * 100) / 100
}

function getWeatherLabel(condition: WeatherCondition, isDay: boolean) {
  switch (condition) {
    case 'clear':
      return isDay ? 'Sunny' : 'Clear night'
    case 'partly-cloudy':
      return isDay ? 'Partly cloudy' : 'Partly cloudy night'
    case 'cloudy':
      return 'Cloudy'
    case 'fog':
      return 'Foggy'
    case 'rain':
      return 'Rainy'
    case 'snow':
      return 'Snowy'
    case 'thunder':
      return 'Thunderstorm'
  }
}

export function weatherConditionFromCode(weatherCode: number): WeatherCondition {
  if (weatherCode === 0) {
    return 'clear'
  }

  if (weatherCode >= 1 && weatherCode <= 3) {
    return weatherCode === 3 ? 'cloudy' : 'partly-cloudy'
  }

  if (weatherCode === 45 || weatherCode === 48) {
    return 'fog'
  }

  if (
    (weatherCode >= 51 && weatherCode <= 67) ||
    (weatherCode >= 80 && weatherCode <= 82)
  ) {
    return 'rain'
  }

  if ((weatherCode >= 71 && weatherCode <= 77) || weatherCode === 85 || weatherCode === 86) {
    return 'snow'
  }

  if (weatherCode >= 95 && weatherCode <= 99) {
    return 'thunder'
  }

  return 'cloudy'
}

export function buildWeatherSnapshot(weatherCode: number, isDayValue: number | boolean) {
  const isDay = Boolean(isDayValue)
  const condition = weatherConditionFromCode(weatherCode)

  return {
    condition,
    label: getWeatherLabel(condition, isDay),
    isDay,
    weatherCode,
    fetchedAt: Date.now(),
  } satisfies WeatherSnapshot
}

export function readCachedWeather(latitude: number, longitude: number) {
  try {
    const rawValue = window.localStorage.getItem(WEATHER_CACHE_KEY)

    if (!rawValue) {
      return null
    }

    const cachedValue = JSON.parse(rawValue) as CachedWeatherSnapshot
    const isFresh = Date.now() - cachedValue.fetchedAt < WEATHER_CACHE_TTL_MS
    const sameArea =
      roundCoordinate(cachedValue.latitude) === roundCoordinate(latitude) &&
      roundCoordinate(cachedValue.longitude) === roundCoordinate(longitude)

    if (!isFresh || !sameArea) {
      return null
    }

    return {
      condition: cachedValue.condition,
      label: cachedValue.label,
      isDay: cachedValue.isDay,
      weatherCode: cachedValue.weatherCode,
      fetchedAt: cachedValue.fetchedAt,
    } satisfies WeatherSnapshot
  } catch {
    return null
  }
}

export function cacheWeather(
  weather: WeatherSnapshot,
  latitude: number,
  longitude: number,
) {
  try {
    const payload: CachedWeatherSnapshot = {
      ...weather,
      latitude,
      longitude,
    }

    window.localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore storage failures so weather never blocks the library UI.
  }
}

export function getCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation unavailable.'))
      return
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      maximumAge: 10 * 60 * 1000,
      timeout: 8000,
    })
  })
}

export async function fetchCurrentWeather(latitude: number, longitude: number) {
  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=weather_code,is_day&forecast_days=1&timezone=auto`,
  )

  if (!response.ok) {
    throw new Error('Weather request failed.')
  }

  const payload = (await response.json()) as WeatherApiResponse
  const weatherCode = payload.current?.weather_code
  const isDay = payload.current?.is_day

  if (typeof weatherCode !== 'number' || typeof isDay !== 'number') {
    throw new Error('Weather response incomplete.')
  }

  return buildWeatherSnapshot(weatherCode, isDay)
}
