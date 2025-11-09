/**
 * Firebase Cloud Function for Hybrid ANPR-GPS Toll Calculation.
 *
 * This function triggers whenever a vehicle trip is updated by an ANPR camera.
 * It acts as the central backend logic to determine the correct tolling method
 * based on the user's real-time GPS status from their mobile app.
 *
 * @version 1.1.0
 * @author Gemini Assistant
 * @last-updated 2025-11-02
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
// Import the v2 function trigger for Firestore.
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");

// Initialize the Firebase Admin SDK.
initializeApp();
const db = getFirestore();

/**
 * Calculates the Haversine distance between two geographical coordinates.
 * @param {{lat: number, lng: number}} coords1 - The first coordinate object.
 * @param {{lat: number, lng: number}} coords2 - The second coordinate object.
 * @returns {number} The distance between the two points in meters.
 */
function haversineDistance(coords1, coords2) {
  const R = 6371e3; // Earth's radius in meters
  const lat1Rad = coords1.lat * (Math.PI / 180);
  const lat2Rad = coords2.lat * (Math.PI / 180);
  const deltaLat = (coords2.lat - coords1.lat) * (Math.PI / 180);
  const deltaLng = (coords2.lng - coords1.lng) * (Math.PI / 180);

  const a = Math.sin(deltaLat / 2) ** 2 +
            Math.cos(lat1Rad) * Math.cos(lat2Rad) *
            Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Fetches the physical location of a camera from a toll zone document.
 * @param {string} cameraId - The ID of the camera to find.
 * @param {string} tollZoneId - The ID of the toll zone where the camera is located.
 * @returns {Promise<{lat: number, lng: number}|null>} A promise that resolves to the location object or null if not found.
 */
async function getCameraLocation(cameraId, tollZoneId) {
    const zoneDoc = await db.collection("tollZones").doc(tollZoneId).get();
    if (!zoneDoc.exists) {
        console.error(`Error: Toll zone document ${tollZoneId} not found.`);
        return null;
    }
    const operators = zoneDoc.data().operators || {};
    const location = operators[cameraId]?.location;
    if (!location) {
        console.error(`Error: Location for camera ${cameraId} not found in zone ${tollZoneId}.`);
    }
    return location || null;
}

/**
 * Main cloud function that triggers on vehicle sighting.
 * It calculates a toll segment based on the user's GPS status.
 */
exports.calculateTollOnSighting = onDocumentUpdated({
    document: "vehicle_trips/{tripId}",
    // Specify the region to match your database for lower latency and cost.
    region: "asia-south1",
}, async (event) => {
    // Extract data from the event object.
    const { change, params } = event;
    if (!change) {
        console.log("No data change associated with the event. Exiting.");
        return;
    }

    const beforeData = change.before.data();
    const afterData = change.after.data();
    const tripId = params.tripId;
    const tripRef = change.after.ref;

    // Prevent infinite loops by exiting if the triggering field hasn't changed.
    if (beforeData.lastCheckpoint === afterData.lastCheckpoint) {
        return;
    }

    // This logic only applies to vehicles registered to a user in the app.
    if (!afterData.userId) {
        console.log(`Trip ${tripId} has no registered user. ANPR client is responsible for toll.`);
        return;
    }

    const TOLL_RATE_PER_METER = 1; // Toll rate in INR per meter.

    // Fetch the associated user's document to check their live GPS status.
    const userDoc = await db.collection("users").doc(afterData.userId).get();
    if (!userDoc.exists) {
        console.error(`Error: User ${afterData.userId} for trip ${tripId} not found.`);
        return;
    }
    const userGpsStatus = userDoc.data().gpsStatusInZone;

    // --- SCENARIO 1: GPS is ON ---
    // If the user's mobile app reports a live GPS connection, defer to the app.
    // The app will handle the toll calculation with high-precision GPS data.
    if (userGpsStatus === "Connected") {
        console.log(`User ${afterData.userId} GPS is 'Connected'. Deferring to mobile app.`);
        await tripRef.update({ calculationMethod: "GPS" });
        return;
    }

    // --- SCENARIOS 2 & 3: GPS is OFF ---
    // The backend must now calculate the toll using ANPR camera data as a fallback.
    console.log(`User ${afterData.userId} GPS is OFF. Calculating toll on backend for trip ${tripId}.`);
    const previousCheckpointId = beforeData.lastCheckpoint;
    const currentCheckpointId = afterData.lastCheckpoint;
    let distanceForToll = 0;

    const currentCameraLocation = await getCameraLocation(currentCheckpointId, afterData.tollZoneId);
    if (!currentCameraLocation) return;

    // --- SCENARIO 3: HYBRID Calculation ---
    // The app was tracking via GPS, lost signal, and saved the last known location.
    // Calculate distance from that last GPS point to the new camera sighting.
    if (afterData.calculationMethod === "HYBRID" && afterData.lastKnownGpsLocation) {
        console.log(`Using HYBRID method for trip ${tripId}.`);
        distanceForToll = haversineDistance(afterData.lastKnownGpsLocation, currentCameraLocation);
    } else {
    // --- SCENARIO 2: PURE ANPR Calculation ---
    // GPS has been off. Calculate distance from the previous camera to the current camera.
        console.log(`Using ANPR method for trip ${tripId}.`);
        const previousCameraLocation = await getCameraLocation(previousCheckpointId, afterData.tollZoneId);
        if (!previousCameraLocation) return;
        distanceForToll = haversineDistance(previousCameraLocation, currentCameraLocation);
    }

    if (distanceForToll > 0) {
        const segmentToll = distanceForToll * TOLL_RATE_PER_METER;
        const newTotalToll = (afterData.totalToll || 0) + segmentToll;

        console.log(`Segment toll for trip ${tripId}: ₹${segmentToll.toFixed(2)}. New total: ₹${newTotalToll.toFixed(2)}.`);

        
        await tripRef.update({
            totalToll: newTotalToll,
         
            calculationMethod: "ANPR",
        });
    }
});