const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");

initializeApp();
const db = getFirestore();

// Helper function to calculate distance
function haversineDistance(coords1, coords2) {
  if (!coords1 || !coords2) return 0;
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

// Helper function to get a camera's location from the toll zone
async function getCameraLocation(tollZoneId, cameraId) {
    if (!tollZoneId || !cameraId) return null;
    try {
        const zoneDoc = await db.collection("tollZones").doc(tollZoneId).get();
        if (!zoneDoc.exists) return null;
        const operators = zoneDoc.data().operators || {};
        return operators[cameraId]?.location || null;
    } catch (e) {
        console.error(`Error getting camera location for ${cameraId}:`, e);
        return null;
    }
}

// This is the new, "smart" backend function
exports.calculateTollOnSighting = onDocumentUpdated({
    document: "vehicle_trips/{tripId}",
    region: "asia-south1",
}, async (event) => {
    
    const change = event.data;
    if (!change) return;

    const beforeData = change.before.data();
    const afterData = change.after.data();
    const tripRef = change.after.ref;

    // 1. EXIT if this wasn't a 'lastCheckpoint' update
    if (beforeData.lastCheckpoint === afterData.lastCheckpoint) {
      return;
    }
    
    // 2. EXIT if the app is handling it (GPS)
    if (afterData.calculationMethod === "GPS") {
      console.log(`Trip ${event.params.tripId} is GPS-managed. Backend will not charge.`);
      return;
    }

    // 3. We are now in SCENARIO 2 or 3.
    // We will calculate the toll regardless of whether the user is registered.
    console.log(`Backend processing toll for trip ${event.params.tripId}...`);
    
    const TOLL_RATE_PER_METER = 1; // 1 INR per meter
    const { 
      tollZoneId, 
      lastCheckpoint, // This is the *new* camera
      calculationMethod, 
      lastKnownGpsLocation 
    } = afterData;

    const previousCheckpoint = beforeData.lastCheckpoint;
    let startLocation = null;
    let endLocation = null;
    let updatePayload = {};

    endLocation = await getCameraLocation(tollZoneId, lastCheckpoint);
    if (!endLocation) {
        console.error(`Could not find location for current camera ${lastCheckpoint}.`);
        return;
    }
    
    // SCENARIO 3: HYBRID calculation (GPS was lost mid-trip)
    if (calculationMethod === "HYBRID" && lastKnownGpsLocation) {
        console.log("Using HYBRID calculation: lastKnownGpsLocation -> currentCamera");
        startLocation = lastKnownGpsLocation;
        
        // Prepare to clear the hybrid fields after this one-time calculation
        updatePayload = {
            calculationMethod: "ANPR",
            lastKnownGpsLocation: FieldValue.delete(),
            lastGpsUpdateTimestamp: FieldValue.delete()
        };
        
    // SCENARIO 2: PURE ANPR calculation (GPS was always off)
    } else { // calculationMethod is 'ANPR'
        console.log("Using ANPR calculation: previousCamera -> currentCamera");
        startLocation = await getCameraLocation(tollZoneId, previousCheckpoint);
    }
    
    // 4. Calculate Toll
    if (!startLocation) {
        console.log(`No start location for trip segment (Previous cam: ${previousCheckpoint}). Skipping charge for this segment.`);
        return;
    }

    const distanceMeters = haversineDistance(startLocation, endLocation);
    if (distanceMeters <= 0) {
        console.log("Distance is zero, no toll to charge.");
        return;
    }
    
    const segmentToll = Math.max(0, Math.round(distanceMeters * TOLL_RATE_PER_METER));
    console.log(`Calculated segment toll of ₹${segmentToll.toFixed(2)}`);

    // Add the new toll to any existing toll
    updatePayload.totalToll = FieldValue.increment(segmentToll);

    // --- 5. THIS IS THE NEW LOGIC ---
    // Check if the user is registered.
    if (afterData.userId) {
        // --- REGISTERED USER ---
        // Try to charge their wallet via a transaction
        console.log(`Attempting to charge registered user ${afterData.userId}`);
        try {
            const userDocRef = db.collection("users").doc(afterData.userId);
            
            await db.runTransaction(async (transaction) => {
                const userDoc = await transaction.get(userDocRef);
                if (!userDoc.exists) throw new Error("User not found");
                
                const walletBalance = userDoc.data().walletBalance;
                if (walletBalance - segmentToll < 500) {
                    // Handle low balance
                    console.error(`User ${afterData.userId} has insufficient funds for toll.`);
                    updatePayload.status = "pending_payment";
                } else {
                    // Deduct from wallet
                    transaction.update(userDocRef, { 
                        walletBalance: FieldValue.increment(-segmentToll) 
                    });
                }
                
                // Update the trip document
                transaction.update(tripRef, updatePayload);
                
                // Add a receipt to the transactions collection
                const transCollectionRef = db.collection("transactions");
                transaction.set(transCollectionRef.doc(), {
                    userId: afterData.userId,
                    zoneId: tollZoneId,
                    zoneName: afterData.tollZoneName,
                    amount: segmentToll,
                    distance: `${distanceMeters.toFixed(0)}m`,
                    type: 'debit',
                    timestamp: FieldValue.serverTimestamp(),
                    calculationMethod: calculationMethod // 'HYBRID' or 'ANPR'
                });
            });
            
        } catch (e) {
            console.error("Failed to charge REGISTERED user:", e);
        }
        
    } else {
        // --- UNREGISTERED USER ---
        // Just update the vehicle_trips document with the new toll.
        console.log("Vehicle is unregistered. Updating totalToll on trip document only.");
        try {
            await tripRef.update(updatePayload);
        } catch (e) {
            console.error("Failed to update toll for UNREGISTERED user:", e);
        }
    }
}); 