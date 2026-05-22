import { NextResponse, type NextRequest } from "next/server";

type DailyPayload = {
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
  };
};

type WeatherSegment = {
  endpoint: string;
  startDate: string;
  endDate: string;
};

const WEATHER_COORDINATES = {
  latitude: 41.95,
  longitude: 24.15
};

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const startDate = request.nextUrl.searchParams.get("start");
  const endDate = request.nextUrl.searchParams.get("end");
  if (!isISODate(startDate) || !isISODate(endDate) || startDate > endDate) {
    return NextResponse.json({ error: "Invalid weather date range." }, { status: 400 });
  }

  const segments = buildSegments(startDate, endDate);
  const results = await Promise.allSettled(segments.map(fetchWeatherSegment));
  const daily = results.reduce<Required<DailyPayload>["daily"]>((merged, result) => {
    if (result.status !== "fulfilled") return merged;
    const source = result.value.daily || {};
    (source.time || []).forEach((date, index) => {
      merged.time?.push(date);
      merged.weather_code?.push(source.weather_code?.[index] ?? 0);
      merged.temperature_2m_max?.push(source.temperature_2m_max?.[index] ?? 0);
      merged.temperature_2m_min?.push(source.temperature_2m_min?.[index] ?? 0);
    });
    return merged;
  }, { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [] });

  return NextResponse.json({ daily });
}

function buildSegments(startDate: string, endDate: string): WeatherSegment[] {
  const today = localISODate(new Date());
  const lastPastDate = shiftISODate(today, -1);
  const lastForecastDate = shiftISODate(today, 15);
  return [
    makeSegment("https://archive-api.open-meteo.com/v1/archive", startDate, minISODate(endDate, lastPastDate)),
    makeSegment("https://api.open-meteo.com/v1/forecast", maxISODate(startDate, today), minISODate(endDate, lastForecastDate)),
    makeSegment("https://seasonal-api.open-meteo.com/v1/seasonal", maxISODate(startDate, shiftISODate(lastForecastDate, 1)), endDate)
  ].filter((segment): segment is WeatherSegment => Boolean(segment));
}

function makeSegment(endpoint: string, startDate: string, endDate: string): WeatherSegment | null {
  return startDate <= endDate ? { endpoint, startDate, endDate } : null;
}

async function fetchWeatherSegment(segment: WeatherSegment): Promise<DailyPayload> {
  const params = new URLSearchParams({
    latitude: String(WEATHER_COORDINATES.latitude),
    longitude: String(WEATHER_COORDINATES.longitude),
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    timezone: "Europe/Sofia",
    start_date: segment.startDate,
    end_date: segment.endDate
  });
  const response = await fetch(`${segment.endpoint}?${params.toString()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Weather segment failed: ${response.status}`);
  return response.json();
}

function isISODate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function minISODate(a: string, b: string): string {
  return a < b ? a : b;
}

function maxISODate(a: string, b: string): string {
  return a > b ? a : b;
}

function shiftISODate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return localISODate(date);
}

function localISODate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}
