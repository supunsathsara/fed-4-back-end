/**
 * Data API Sync Service
 *
 * Bridges the Backend ↔ Data API for solar unit lifecycle events.
 *
 * When an admin creates, updates, or deletes a solar unit in the backend,
 * this service mirrors those changes to the Data API so that:
 * - The cron job starts generating simulated data for new units
 * - IoT devices can authenticate and push real readings
 * - Deleted/inactive units stop receiving simulated data
 *
 * The Data API is the source of truth for energy data.
 * The Backend is the source of truth for user assignments & billing.
 * serialNumber is the shared key between the two systems.
 */

const DATA_API_URL = process.env.DATA_API_URL || "http://localhost:8001";

// ── Status Mapping ─────────────────────────────────────────────
// Backend uses: ACTIVE, INACTIVE, MAINTENANCE
// Data API uses: ONLINE, OFFLINE, MAINTENANCE

type BackendStatus = "ACTIVE" | "INACTIVE" | "MAINTENANCE";
type DataAPIStatus = "ONLINE" | "OFFLINE" | "MAINTENANCE";

function mapStatus(backendStatus: BackendStatus): DataAPIStatus {
  switch (backendStatus) {
    case "ACTIVE":
      return "ONLINE";
    case "INACTIVE":
      return "OFFLINE";
    case "MAINTENANCE":
      return "MAINTENANCE";
    default:
      return "ONLINE";
  }
}

// ── Types ──────────────────────────────────────────────────────

interface RegisterUnitPayload {
  serialNumber: string;
  name: string;
  capacity: number;
  location?: {
    latitude: number;
    longitude: number;
    timezone?: string;
  };
  metadata?: {
    panelType?: string;
    inverterModel?: string;
    tiltAngle?: number;
    azimuth?: number;
  };
}

// ── Sync Functions ─────────────────────────────────────────────

/**
 * Register a solar unit in the Data API when it's created in the backend.
 * Uses default location (Colombo, Sri Lanka) if none provided.
 *
 * Returns the device API key from the Data API (for IoT device provisioning).
 * If the unit already exists in the Data API, returns the existing key.
 */
export async function syncUnitCreated(payload: RegisterUnitPayload): Promise<{ apiKey?: string }> {
  try {
    const body = {
      serialNumber: payload.serialNumber,
      name: payload.name || `Solar Unit ${payload.serialNumber}`,
      capacity: payload.capacity,
      location: payload.location || {
        latitude: 6.9271,   // Default: Colombo, Sri Lanka
        longitude: 79.8612,
        timezone: "Asia/Colombo",
      },
      metadata: payload.metadata || {},
    };

    const response = await fetch(`${DATA_API_URL}/api/solar-units/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (response.ok || response.status === 409) {
      // 409 = already exists, which is fine (idempotent)
      const data = (await response.json()) as { apiKey?: string };
      console.log(`[DataAPI Sync] Registered unit ${payload.serialNumber} → API key issued`);
      return { apiKey: data.apiKey };
    }

    const errorText = await response.text();
    console.error(`[DataAPI Sync] Failed to register unit ${payload.serialNumber}: ${response.status} ${errorText}`);
    return {};
  } catch (error) {
    // Don't let Data API failures block the backend operation
    console.error(`[DataAPI Sync] Error registering unit ${payload.serialNumber}:`, error);
    return {};
  }
}

/**
 * Update a solar unit's status in the Data API when it changes in the backend.
 * Maps backend statuses (ACTIVE/INACTIVE/MAINTENANCE) to Data API statuses (ONLINE/OFFLINE/MAINTENANCE).
 */
export async function syncUnitStatusUpdated(
  serialNumber: string,
  backendStatus: BackendStatus
): Promise<void> {
  try {
    const dataApiStatus = mapStatus(backendStatus);

    const response = await fetch(
      `${DATA_API_URL}/api/solar-units/${serialNumber}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: dataApiStatus }),
      }
    );

    if (response.ok) {
      console.log(`[DataAPI Sync] Updated unit ${serialNumber} status → ${dataApiStatus}`);
    } else {
      const errorText = await response.text();
      console.error(`[DataAPI Sync] Failed to update status for ${serialNumber}: ${response.status} ${errorText}`);
    }
  } catch (error) {
    console.error(`[DataAPI Sync] Error updating status for ${serialNumber}:`, error);
  }
}

/**
 * Rotate a solar unit's API key in the Data API.
 * Returns the new key for the admin to flash onto the device.
 */
export async function syncRotateApiKey(serialNumber: string): Promise<{ apiKey?: string }> {
  try {
    const response = await fetch(
      `${DATA_API_URL}/api/solar-units/${serialNumber}/rotate-key`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }
    );

    if (response.ok) {
      const data = (await response.json()) as { apiKey?: string };
      console.log(`[DataAPI Sync] Rotated API key for unit ${serialNumber}`);
      return { apiKey: data.apiKey };
    }

    const errorText = await response.text();
    console.error(`[DataAPI Sync] Failed to rotate key for ${serialNumber}: ${response.status} ${errorText}`);
    return {};
  } catch (error) {
    console.error(`[DataAPI Sync] Error rotating key for ${serialNumber}:`, error);
    return {};
  }
}

/**
 * Mark a solar unit as OFFLINE in the Data API when it's deleted in the backend.
 * We don't delete from the Data API to preserve historical energy data.
 */
export async function syncUnitDeleted(serialNumber: string): Promise<void> {
  try {
    const response = await fetch(
      `${DATA_API_URL}/api/solar-units/${serialNumber}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "OFFLINE" }),
      }
    );

    if (response.ok) {
      console.log(`[DataAPI Sync] Marked unit ${serialNumber} as OFFLINE (deleted from backend)`);
    } else {
      const errorText = await response.text();
      console.error(`[DataAPI Sync] Failed to mark ${serialNumber} offline: ${response.status} ${errorText}`);
    }
  } catch (error) {
    console.error(`[DataAPI Sync] Error marking ${serialNumber} offline:`, error);
  }
}
