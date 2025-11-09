import { FontAwesome5 } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from "@react-native-community/netinfo";
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import {
  addDoc,
  collection,
  doc,
  endAt,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAt,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
  type QuerySnapshot
} from "firebase/firestore";
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, StyleSheet, Text, View } from 'react-native';
import { geohashQueryBounds, distanceBetween } from 'geofire-common';
import { auth, db } from '../../src/firebaseConfig';

// Type definitions
type Point = { lat: number; lng: number; };
type TollZone = { id: string; name: string; coordinates: Point[]; toll_amount?: number; };
type PendingDeduction = { entry: Location.LocationObject; exit: Location.LocationObject; zone: TollZone; };
type GpsStatus = 'Connected' | 'Searching...' | 'Disconnected' | 'Permission Denied';
type OfflineTransaction = {
  userId: string;
  zoneId: string;
  zoneName: string;
  amount: number;
  distance: string;
  timestamp: Date;
};

// Helper function to calculate distance (displacement)
const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3; // metres
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Helper function for geofencing
const isPointInPolygon = (point: Point, polygon: Point[]) => {
  if (!polygon) return false;
  let isInside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].lat, yi = polygon[i].lng;
    const xj = polygon[j].lat, yj = polygon[j].lng;
    const intersect = ((yi > point.lng) !== (yj > point.lng))
      && (point.lat < (xj - xi) * (point.lng - yi) / (yj - yi) + xi);
    if (intersect) isInside = !isInside;
  }
  return isInside;
};

const HomeScreen = () => {
  // State Management
  const [userName, setUserName] = useState('');
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [rawLocation, setRawLocation] = useState<Location.LocationObject | null>(null);
  const [tripLocation, setTripLocation] = useState<Location.LocationObject | null>(null);
  const [tollZones, setTollZones] = useState<TollZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [physicallyInZone, setPhysicallyInZone] = useState<TollZone | null>(null);
  const [tripZone, setTripZone] = useState<TollZone | null>(null);
  const [entryPoint, setEntryPoint] = useState<Location.LocationObject | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [pendingDeduction, setPendingDeduction] = useState<PendingDeduction | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('Searching...');

  // Refs for smoothing and timers
  const locationHistoryRef = useRef<Location.LocationObject[]>([]);
  const exitTimerRef = useRef<number | null>(null);
  const lastZoneFetchLocationRef = useRef<Location.LocationObject | null>(null);

  // Effect to fetch user data (from Firestore)
  useEffect(() => {
    if (!auth.currentUser) return;
    const userDocRef = doc(db, "users", auth.currentUser.uid);
    const unsubscribe = onSnapshot(userDocRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setUserName(data.name || '');
        setWalletBalance(data.walletBalance);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

   // Load any saved pending deduction
  useEffect(() => {
    const loadPendingDeduction = async () => {
      const saved = await AsyncStorage.getItem('pendingDeduction');
      if (saved) {
        console.log("Loaded pending deduction from storage:", saved);
        setPendingDeduction(JSON.parse(saved));
      }
    };
    loadPendingDeduction();
  }, []);

  // --- 1. This hook ONLY gets the raw location from the GPS ---
  useEffect(() => {
    let subscriber: Location.LocationSubscription | null = null;
    const startLocationTracking = async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("Permission Denied", "Location permission is required.");
        setGpsStatus('Permission Denied');
        return;
      }
      subscriber = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 5 },
        (newLocation) => {
          setRawLocation(newLocation);
        }
      );
    };
    startLocationTracking();
    return () => { if (subscriber) { subscriber.remove(); } };
  }, []); // This runs only once.

  // --- 2. This hook fetches nearby toll zones using Geohash ---
  useEffect(() => {
    const fetchNearbyTollZones = async (locationObject: Location.LocationObject) => {
        if (!locationObject) return;

        // --- CHANGE #1: Set re-fetch distance to 1km (100m) ---
        const FETCH_THRESHOLD_METERS = 100; 
        if (lastZoneFetchLocationRef.current) {
            const distanceMoved = getDistance(
                lastZoneFetchLocationRef.current.coords.latitude,
                lastZoneFetchLocationRef.current.coords.longitude,
                locationObject.coords.latitude,
                locationObject.coords.longitude
            );
            if (distanceMoved < FETCH_THRESHOLD_METERS) {
                return;
            }
        }
        
        console.log("User moved > 1km. Fetching new nearby toll zones...");
        lastZoneFetchLocationRef.current = locationObject; 

        const center: [number, number] = [locationObject.coords.latitude, locationObject.coords.longitude];
        
        // --- CHANGE #2: Set search radius to 1km (1000m) ---
        const radiusInM = 1 * 1000; 

        const bounds = geohashQueryBounds(center, radiusInM);
        const promises = [];
        for (const b of bounds) {
            const q = query(
                collection(db, "tollZones"),
                orderBy("geohash"),
                startAt(b[0]),
                endAt(b[1])
            );
            promises.push(getDocs(q));
        }
        
        try {
            const snapshots = await Promise.all(promises);
            const matchingDocs: TollZone[] = [];
            
            for (const snap of snapshots) {
                for (const doc of snap.docs) {
                    const data = doc.data();
                    const points = data.tollZones || data.coordinates;
                    const zoneCenterCoords = data.center; 

                    if (!zoneCenterCoords) {
                        console.warn(`Zone ${data.name} skipped: missing 'center' field.`);
                        continue; 
                    }
                    const zoneCenter: [number, number] = [zoneCenterCoords.lat, zoneCenterCoords.lng];
                    
                    const distanceInKm = distanceBetween(center, zoneCenter);
                    if (distanceInKm * 1000 <= radiusInM) {
                        matchingDocs.push({ id: doc.id, name: data.name, toll_amount: data.toll_amount, coordinates: points });
                        console.log(`Successfully matched nearby zone: ${data.name}`);
                    }
                }
            }
            setTollZones(matchingDocs);
            console.log(`Loaded ${matchingDocs.length} nearby zones.`);
        } catch (error) {
            console.error("CRITICAL ERROR fetching toll zones:", error);
            Alert.alert("Error Loading Zones", "Could not load nearby toll zones. Check console for details.");
        }
    };
    
    if (rawLocation) {
        fetchNearbyTollZones(rawLocation);
    }
  }, [rawLocation]);


  // --- 3. This hook updates the UI (Green/Yellow Card) ---
  useEffect(() => {
    if (!rawLocation || tollZones.length === 0) {
      // If we have a location but no zones, we are "All Clear"
      if (rawLocation) {
        setPhysicallyInZone(null);
      }
      return;
    }
    const rawLocationPoint: Point = { lat: rawLocation.coords.latitude, lng: rawLocation.coords.longitude };
    let currentPhysicalZone: TollZone | null = null;
    for (const zone of tollZones) {
      if (isPointInPolygon(rawLocationPoint, zone.coordinates)) {
        currentPhysicalZone = zone;
        break;
      }
    }
    setPhysicallyInZone(currentPhysicalZone);
  }, [rawLocation, tollZones]);

  // --- 4. This hook creates the 'tripLocation' with all the smoothing/jump logic ---
  useEffect(() => {
    if (!rawLocation) return;
    if (rawLocation.coords.accuracy != null && rawLocation.coords.accuracy > 75) {
      return; 
    }
    if (locationHistoryRef.current.length > 0) {
      const lastLocation = locationHistoryRef.current[locationHistoryRef.current.length - 1];
      const jumpDistance = getDistance(
        lastLocation.coords.latitude, lastLocation.coords.longitude,
        rawLocation.coords.latitude, rawLocation.coords.longitude
      );
      if (jumpDistance > 100) {
        console.log("Large GPS jump detected! Resetting location.");
        setTripLocation(rawLocation);
        locationHistoryRef.current = [rawLocation];
        return;
      }
    }
    if (physicallyInZone) {
      setTripLocation(rawLocation);
      locationHistoryRef.current = [];
    } else {
      locationHistoryRef.current.push(rawLocation);
      if (locationHistoryRef.current.length > 7) {
        locationHistoryRef.current.shift();
      }
      const avgLat = locationHistoryRef.current.reduce((sum, loc) => sum + loc.coords.latitude, 0) / locationHistoryRef.current.length;
      const avgLng = locationHistoryRef.current.reduce((sum, loc) => sum + loc.coords.longitude, 0) / locationHistoryRef.current.length;
      const smoothedLocation = { ...rawLocation, coords: { ...rawLocation.coords, latitude: avgLat, longitude: avgLng } };
      setTripLocation(smoothedLocation);
    }
  }, [rawLocation, physicallyInZone]);

  // --- 5. This hook manages the trip logic (entry, exit, and grace period) ---
  // --- 5. This hook manages the trip logic (entry, exit, and grace period) ---
  useEffect(() => {
    // This is the GPS-based trip *entry* logic
    if (physicallyInZone && !tripZone) {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      setTripZone(physicallyInZone);
      setEntryPoint(tripLocation);

      // --- NEW LOGIC: Mark this as a GPS-managed trip in Firebase ---
      const markTripAsGPS = async () => {
        if (!auth.currentUser || !physicallyInZone) return;
        try {
          const tripsRef = collection(db, "vehicle_trips");
          const q = query(
            tripsRef,
            where("userId", "==", auth.currentUser.uid),
            where("tollZoneId", "==", physicallyInZone.id),
            where("status", "==", "active"),
            limit(1)
          );
          const querySnapshot = await getDocs(q);
          if (!querySnapshot.empty) {
            const tripDocRef = querySnapshot.docs[0].ref;
            await updateDoc(tripDocRef, {
              calculationMethod: "GPS", // Tell the backend the app is handling this
              gpsEntryPoint: { // Save the precise GPS entry point
                 lat: tripLocation?.coords.latitude,
                 lng: tripLocation?.coords.longitude,
              }
            });
          }
        } catch (e) {
          console.error("Failed to mark trip as GPS:", e);
        }
      };
      markTripAsGPS();
      // --- END NEW LOGIC ---

    // This is the GPS-based trip *exit* logic
    } else if (!physicallyInZone && tripZone) {
      if (!exitTimerRef.current) {
        const exitLocation = tripLocation;
        
        const timerId = setTimeout(async () => {
          // --- NEW CHECK: Did the backend take over? ---
          let canCharge = true;
          if (auth.currentUser && tripZone) {
            try {
              const tripsRef = collection(db, "vehicle_trips");
              const q = query(
                tripsRef,
                where("userId", "==", auth.currentUser.uid),
                where("tollZoneId", "==", tripZone.id),
                where("status", "==", "active"),
                limit(1)
              );
              const querySnapshot = await getDocs(q);
              if (!querySnapshot.empty) {
                const calculationMethod = querySnapshot.docs[0].data().calculationMethod;
                if (calculationMethod !== "GPS") {
                  // If method is 'HYBRID' or 'ANPR', the backend is handling it.
                  console.log("GPS lost, backend is handling this toll. App will not charge.");
                  canCharge = false;
                }
              }
            } catch (e) {
              console.error("Error checking calculation method:", e);
            }
          }
          // --- END NEW CHECK ---

          if (canCharge) {
            console.log("GPS-based trip ended. App is charging the toll.");
            calculateAndChargeToll(entryPoint, exitLocation, tripZone);
          }
          
          // Clear local state regardless
          setTripZone(null);
          setEntryPoint(null);
          exitTimerRef.current = null;
        }, 20000); // 20-second grace period
        exitTimerRef.current = Number(timerId);
      }
    }
  }, [physicallyInZone, tripLocation, tripZone, entryPoint]);

  // --- 6. This hook handles pending deductions ---
  useEffect(() => {
    const processPending = async () => {
      if (pendingDeduction && walletBalance && !isOffline) {
        const { entry, exit, zone } = pendingDeduction;
        const distanceMeters = getDistance(entry.coords.latitude, entry.coords.longitude, exit.coords.latitude, exit.coords.longitude);
        const ratePerMeter = 50 / 20;
        const calculatedToll = Math.max(0, Math.round(distanceMeters * ratePerMeter));
        if (walletBalance - calculatedToll >= 500) {
          console.log("Processing stored pending deduction...");
          await new Promise((resolve) => setTimeout(resolve, 500));
          await calculateAndChargeToll(entry, exit, zone);
          setPendingDeduction(null);
          await AsyncStorage.removeItem('pendingDeduction');
        }
      }
    };
    processPending();
  }, [walletBalance, pendingDeduction, isOffline]);
     
  // --- 7. This hook monitors the phone's GPS hardware status ---
  useEffect(() => {
    const checkGpsStatus = async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGpsStatus('Permission Denied');
        return;
      }
      const isGpsEnabled = await Location.hasServicesEnabledAsync();
      if (!isGpsEnabled) {
        setGpsStatus('Disconnected');
      } else if (rawLocation) {
        setGpsStatus('Connected');
      } else {
        setGpsStatus('Searching...');
      }
    };
    checkGpsStatus();
    const intervalId = setInterval(checkGpsStatus, 3000);
    const appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        checkGpsStatus();
      }
    });
    return () => {
      clearInterval(intervalId);
      appStateSubscription.remove();
    };
  }, [rawLocation]);

  // --- 8. This hook handles logic based on GPS status (Alerts, saving to Firebase) ---
  useEffect(() => {
    if (!auth.currentUser) return;
    if (physicallyInZone && gpsStatus === 'Disconnected') {
      Alert.alert(
        "GPS is Off",
        "Your GPS is turned off. Please turn on your device's location to ensure accurate toll tracking.",
        [{ text: "OK" }]
      );
    }
    const userDocRef = doc(db, "users", auth.currentUser.uid);
    updateDoc(userDocRef, {
      gpsStatusInZone: physicallyInZone ? gpsStatus : 'not needed'
    });
    if (physicallyInZone && gpsStatus === 'Disconnected' && rawLocation) {
      const saveLastGpsLocation = async () => {
        try {
          const tripsRef = collection(db, "vehicle_trips");
          const q = query(
            tripsRef,
            where("userId", "==", auth.currentUser?.uid),
            where("tollZoneId", "==", physicallyInZone.id),
            where("status", "==", "active"),
            limit(1)
          );
          const querySnapshot = await getDocs(q);
          if (!querySnapshot.empty) {
            const activeTripDoc = querySnapshot.docs[0];
            const tripDocRef = doc(db, "vehicle_trips", activeTripDoc.id);
            await updateDoc(tripDocRef, {
              lastKnownGpsLocation: {
                lat: rawLocation.coords.latitude,
                lng: rawLocation.coords.longitude,
              },
              lastGpsUpdateTimestamp: serverTimestamp(),
              calculationMethod: "HYBRID"
            });
          }
        } catch (error) {
          console.error("Failed to save last known GPS location:", error);
        }
      };
      saveLastGpsLocation();
    }
  }, [physicallyInZone, gpsStatus, rawLocation]);
  
  // --- 9. This hook listens for network changes ---
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const isCurrentlyOffline = !state.isConnected || !state.isInternetReachable;
      setIsOffline(isCurrentlyOffline);
      if (isCurrentlyOffline === false) {
        console.log("App is back online. Syncing offline transactions...");
        syncOfflineTransactions();
      }
    });
    return () => unsubscribe();
  }, []);

  const syncOfflineTransactions = async () => {
    if (!auth.currentUser) return;
    try {
      const savedTxs = await AsyncStorage.getItem('offlineTransactions');
      if (savedTxs === null) return;
      const transactions: OfflineTransaction[] = JSON.parse(savedTxs);
      const userId = auth.currentUser.uid;
      const userDocRef = doc(db, "users", userId);
      for (const tx of transactions) {
        await updateDoc(userDocRef, { walletBalance: increment(-tx.amount) });
        await addDoc(collection(db, "transactions"), {
          userId: tx.userId,
          zoneId: tx.zoneId,
          zoneName: tx.zoneName,
          amount: tx.amount,
          distance: tx.distance,
          type: 'debit',
          timestamp: new Date(tx.timestamp), 
          
        });
        console.log(`Successfully synced offline transaction for ${tx.zoneName}`);
      }
      await AsyncStorage.removeItem('offlineTransactions');
    } catch (e) {
      console.error("Failed to sync offline transactions:", e);
    }
  };

  const calculateAndChargeToll = async (entry: Location.LocationObject | null, exit: Location.LocationObject | null, zone: TollZone | null) => {
    if (!entry || !exit || !zone || !auth.currentUser) return;
    const distanceMeters = getDistance(entry.coords.latitude, entry.coords.longitude, exit.coords.latitude, exit.coords.longitude);
    const ratePerMeter = 50 / 20;
    const calculatedToll = Math.max(0, Math.round(distanceMeters * ratePerMeter));
    const userId = auth.currentUser.uid;

    if (isOffline) {
      Alert.alert(
        "Offline: Toll Saved", 
        `You traveled ${distanceMeters.toFixed(0)}m. A toll of ₹${calculatedToll.toFixed(2)} will be deducted when you reconnect.`
      );
      const newOfflineTx: OfflineTransaction = {
        userId,
        zoneId: zone.id,
        zoneName: zone.name,
        amount: calculatedToll,
        distance: `${distanceMeters.toFixed(0)}m`,
        timestamp: new Date(),
      };
      const existingTxs = await AsyncStorage.getItem('offlineTransactions');
      const txs = existingTxs ? JSON.parse(existingTxs) : [];
      txs.push(newOfflineTx);
      await AsyncStorage.setItem('offlineTransactions', JSON.stringify(txs));

    } else {
      if (walletBalance !== null && walletBalance - calculatedToll < 500) {
        Alert.alert("Low Balance", `Toll of ₹${calculatedToll.toFixed(2)} could not be charged. This amount will be deducted automatically once your balance is sufficient.`);
        if (!pendingDeduction) {
          const newPending = { entry, exit, zone };
          setPendingDeduction(newPending);
          await AsyncStorage.setItem('pendingDeduction', JSON.stringify(newPending));
        }
        return;
      }
      const userDocRef = doc(db, "users", userId);
      await updateDoc(userDocRef, { walletBalance: increment(-calculatedToll) });
      await addDoc(collection(db, "transactions"), { userId, zoneId: zone.id, zoneName: zone.name, amount: calculatedToll, distance: `${distanceMeters.toFixed(0)}m`, type: 'debit', timestamp: serverTimestamp(),calculationMethod: 'GPS' });
      Alert.alert("Toll Charged", `You traveled ${distanceMeters.toFixed(0)}m. A toll of ₹${calculatedToll.toFixed(2)} has been deducted.`);
    }
  };

  if (loading) {
    return <ActivityIndicator size="large" style={styles.loader} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Hello,</Text>
        <Text style={styles.userName}>{userName || 'User'}</Text>
      </View>
      <View style={styles.infoContainer}>
        <View style={styles.infoBox}>
          <FontAwesome5 name="wallet" size={20} color="#8f94fb" style={styles.infoIcon} />
          <View>
            <Text style={styles.infoLabel}>Wallet Balance</Text>
            <Text style={styles.infoValue}>₹{walletBalance?.toFixed(2) || '0.00'}</Text>
          </View>
        </View>
        <View style={styles.infoBox}>
          <FontAwesome5 name="map-marker-alt" size={20} color="#666" style={styles.infoIcon} />
          <View>
            <Text style={styles.infoLabel}>GPS Status</Text>
            <Text style={styles.infoValue}>{gpsStatus}</Text>
          </View>
        </View>
      </View>
      <LinearGradient
        colors={physicallyInZone ? ['#FFD166', '#FFB703'] : ['#4DDE9B', '#34A853']}
        style={styles.statusCard}
      >
        {physicallyInZone ? (
          <>
            <FontAwesome5 name="exclamation-circle" style={styles.icon} color="#fff" />
            <Text style={styles.title}>Entering Zone</Text>
            <Text style={styles.zoneName}>{physicallyInZone.name}</Text>
          </>
        ) : (
          <>
            <FontAwesome5 name="check-circle" style={styles.icon} color="#fff" />
            <Text style={styles.title}>All Clear</Text>
            <Text style={styles.subtitle}>You are not in a toll zone.</Text>
          </>
        )}
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5', padding: 20 },
  loader: { flex: 1, justifyContent: 'center', backgroundColor: '#f0f2f5' },
  header: { marginTop: 50, marginBottom: 20 },
  greeting: { fontSize: 22, color: '#888' },
  userName: { fontSize: 34, fontWeight: '700', color: '#222' },
  infoContainer: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#fff', borderRadius: 20, paddingVertical: 20, marginBottom: 25, shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.08, shadowRadius: 15, elevation: 5 },
  infoBox: { flexDirection: 'row', alignItems: 'center' },
  infoIcon: { marginRight: 10 },
  infoLabel: { fontSize: 14, color: 'gray' },
  infoValue: { fontSize: 18, fontWeight: '600', color: '#222' },
  statusCard: { flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center', borderRadius: 30, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 5 },
  icon: { fontSize: 60, marginBottom: 15, textShadowColor: 'rgba(0, 0, 0, 0.15)', textShadowOffset: { width: 0, height: 4 }, textShadowRadius: 10 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  subtitle: { fontSize: 18, color: 'rgba(255, 255, 255, 0.9)', marginTop: 8 },
  zoneName: { fontSize: 22, fontWeight: '600', textAlign: 'center', color: '#fff', marginTop: 8 },
});

export default HomeScreen;