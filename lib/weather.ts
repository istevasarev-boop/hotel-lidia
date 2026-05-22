"use client";

export type DailyWeather = {
  date: string;
  icon: string;
  maxTemp: number | null;
  minTemp: number | null;
};

type OpenMeteoDailyResponse = {
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
  };
};

const WEATHER_CACHE_KEY = "hotel_lidia_weather_week_v1";
const WEATHER_CACHE_TTL_MS = 3 * 60 * 60 * 1000;

export const weatherLocation = {
  label: "Цигов чарк",
  latitude: 41.95,
  longitude: 24.15
};

export async function fetchWeeklyWeather(startDate: string, endDate: string): Promise<Record<string, DailyWeather>> {
  return fetchWeatherFromEndpoint("https://api.open-meteo.com/v1/forecast", startDate, endDate, "weekly");
}

export async function fetchCalendarWeather(startDate: string, endDate: string): Promise<Record<string, DailyWeather>> {
  const cacheKey = `calendar:${weatherLocation.latitude},${weatherLocation.longitude}:${startDate}:${endDate}`;
  const cached = readWeatherCache(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({ start: startDate, end: endDate });
  const response = await fetch(`/api/weather/calendar?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Calendar weather failed: ${response.status}`);

  const data = toWeatherMap(await response.json());
  writeWeatherCache(cacheKey, data);
  return data;
}

async function fetchWeatherFromEndpoint(endpoint: string, startDate: string, endDate: string, cacheScope: string): Promise<Record<string, DailyWeather>> {
  const cacheKey = `${cacheScope}:${weatherLocation.latitude},${weatherLocation.longitude}:${startDate}:${endDate}`;
  const cached = readWeatherCache(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    latitude: String(weatherLocation.latitude),
    longitude: String(weatherLocation.longitude),
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    timezone: "Europe/Sofia",
    start_date: startDate,
    end_date: endDate
  });
  const response = await fetch(`${endpoint}?${params.toString()}`, {
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Weather forecast failed: ${response.status}`);

  const data = toWeatherMap(await response.json());
  writeWeatherCache(cacheKey, data);
  return data;
}

export function mapWeatherCodeToIcon(code: number | undefined): string {
  if (code === undefined || !Number.isFinite(code)) return "";
  if (code === 0) return "☀️";
  if ([1, 2].includes(code)) return "⛅";
  if (code === 3) return "☁️";
  if ([45, 48].includes(code)) return "🌫️";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "🌧️";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "❄️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return "⛅";
}

function toWeatherMap(payload: OpenMeteoDailyResponse): Record<string, DailyWeather> {
  const daily = payload.daily || {};
  const dates = daily.time || [];
  return dates.reduce<Record<string, DailyWeather>>((result, date, index) => {
    result[date] = {
      date,
      icon: mapWeatherCodeToIcon(daily.weather_code?.[index]),
      maxTemp: roundTemperature(daily.temperature_2m_max?.[index]),
      minTemp: roundTemperature(daily.temperature_2m_min?.[index])
    };
    return result;
  }, {});
}

function roundTemperature(value: number | undefined): number | null {
  return Number.isFinite(value) ? Math.round(Number(value)) : null;
}

function readWeatherCache(cacheKey: string): Record<string, DailyWeather> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { key?: string; timestamp?: number; data?: Record<string, DailyWeather> };
    if (parsed.key !== cacheKey || !parsed.timestamp || !parsed.data) return null;
    if (Date.now() - parsed.timestamp > WEATHER_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeWeatherCache(cacheKey: string, data: Record<string, DailyWeather>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({
      key: cacheKey,
      timestamp: Date.now(),
      data
    }));
  } catch {
    // Weather is contextual only; storage failures should never affect operations.
  }
}
