import { NextFunction, Request, Response } from "express";


const OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast";

interface WeatherData {
  location: {
    latitude: number;
    longitude: number;
    timezone: string;
  };
  current: {
    temperature: number;
    humidity: number;
    cloudCover: number;
    uvIndex: number;
    weatherCode: number;
    weatherDescription: string;
    isDay: boolean;
    windSpeed: number;
    precipitation: number;
  };
  solarImpact: {
    productionPotential: "excellent" | "good" | "moderate" | "poor";
    productionPercentage: number;
    factors: string[];
  };
  hourlyForecast: Array<{
    time: string;
    temperature: number;
    cloudCover: number;
    uvIndex: number;
  }>;
}

// Weather codes mapping from WMO
const getWeatherDescription = (code: number): string => {
  const weatherCodes: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
  };
  return weatherCodes[code] || "Unknown";
};

// Calculate solar production potential based on weather conditions
const calculateSolarImpact = (
  cloudCover: number,
  uvIndex: number,
  precipitation: number,
  weatherCode: number
): WeatherData["solarImpact"] => {
  const factors: string[] = [];
  let productionPercentage = 100;

  // Cloud cover impact (major factor)
  if (cloudCover <= 10) {
    factors.push("Clear skies - optimal solar conditions");
  } else if (cloudCover <= 30) {
    productionPercentage -= 10;
    factors.push("Light cloud cover - minimal impact");
  } else if (cloudCover <= 60) {
    productionPercentage -= 30;
    factors.push("Moderate cloud cover - reduced production");
  } else if (cloudCover <= 80) {
    productionPercentage -= 50;
    factors.push("Heavy cloud cover - significant reduction");
  } else {
    productionPercentage -= 70;
    factors.push("Overcast - severely limited production");
  }

  // UV Index impact
  if (uvIndex >= 8) {
    factors.push("High UV index - excellent solar radiation");
  } else if (uvIndex >= 5) {
    factors.push("Moderate UV index - good solar radiation");
  } else if (uvIndex >= 3) {
    productionPercentage -= 10;
    factors.push("Low UV index - reduced solar radiation");
  } else {
    productionPercentage -= 20;
    factors.push("Very low UV index - minimal solar radiation");
  }

  // Precipitation impact
  if (precipitation > 0) {
    productionPercentage -= 15;
    factors.push("Precipitation present - additional reduction");
  }

  // Weather code specific impacts (storms, fog, etc.)
  if (weatherCode >= 95) {
    productionPercentage -= 20;
    factors.push("Thunderstorm activity - safety concerns");
  } else if (weatherCode >= 45 && weatherCode <= 48) {
    productionPercentage -= 25;
    factors.push("Foggy conditions - diffused light");
  }

  // Ensure percentage stays within bounds
  productionPercentage = Math.max(5, Math.min(100, productionPercentage));

  // Determine production potential category
  let productionPotential: WeatherData["solarImpact"]["productionPotential"];
  if (productionPercentage >= 80) {
    productionPotential = "excellent";
  } else if (productionPercentage >= 60) {
    productionPotential = "good";
  } else if (productionPercentage >= 40) {
    productionPotential = "moderate";
  } else {
    productionPotential = "poor";
  }

  return {
    productionPotential,
    productionPercentage,
    factors,
  };
};

// Simple in-memory cache
interface CacheEntry {
  data: WeatherData;
  timestamp: number;
}

const weatherCache = new Map<string, CacheEntry>();
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

export const getWeatherData = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Default to Colombo, Sri Lanka coordinates (can be made dynamic via query params)
    const latitude = parseFloat(req.query.lat as string) || 6.9271;
    const longitude = parseFloat(req.query.lon as string) || 79.8612;

    // Create cache key based on coordinates
    const cacheKey = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
    
    // Check cache
    const cached = weatherCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log("Returning cached weather data");
      return res.status(200).json(cached.data);
    }

    const params = new URLSearchParams({
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      current: [
        "temperature_2m",
        "relative_humidity_2m",
        "cloud_cover",
        "uv_index",
        "weather_code",
        "is_day",
        "wind_speed_10m",
        "precipitation",
      ].join(","),
      hourly: ["temperature_2m", "cloud_cover", "uv_index"].join(","),
      forecast_days: "1",
      timezone: "auto",
    });

    const response = await fetch(`${OPEN_METEO_BASE_URL}?${params}`);

    if (!response.ok) {
      // If rate limited and we have old cache, return it
      if (response.status === 429 && cached) {
        console.log("Rate limited - returning stale cache");
        return res.status(200).json(cached.data);
      }
      throw new Error(`Weather API error: ${response.statusText}`);
    }

    const data: any = await response.json();

    // Extract current weather
    const current = data.current;
    const hourly = data.hourly;

    // Calculate solar impact
    const solarImpact = calculateSolarImpact(
      current.cloud_cover,
      current.uv_index || 0,
      current.precipitation,
      current.weather_code
    );

    // Format hourly forecast (next 12 hours)
    const currentHour = new Date().getHours();
    const hourlyForecast = [];
    for (let i = 0; i < 12 && i < hourly.time.length; i++) {
      hourlyForecast.push({
        time: hourly.time[currentHour + i] || hourly.time[i],
        temperature: hourly.temperature_2m[currentHour + i] || hourly.temperature_2m[i],
        cloudCover: hourly.cloud_cover[currentHour + i] || hourly.cloud_cover[i],
        uvIndex: hourly.uv_index?.[currentHour + i] || hourly.uv_index?.[i] || 0,
      });
    }

    const weatherData: WeatherData = {
      location: {
        latitude: data.latitude,
        longitude: data.longitude,
        timezone: data.timezone,
      },
      current: {
        temperature: current.temperature_2m,
        humidity: current.relative_humidity_2m,
        cloudCover: current.cloud_cover,
        uvIndex: current.uv_index || 0,
        weatherCode: current.weather_code,
        weatherDescription: getWeatherDescription(current.weather_code),
        isDay: current.is_day === 1,
        windSpeed: current.wind_speed_10m,
        precipitation: current.precipitation,
      },
      solarImpact,
      hourlyForecast,
    };

    // Store in cache
    weatherCache.set(cacheKey, {
      data: weatherData,
      timestamp: Date.now(),
    });

    res.status(200).json(weatherData);
  } catch (error) {
    next(error);
  }
};
