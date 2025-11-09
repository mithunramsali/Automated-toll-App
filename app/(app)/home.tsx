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
import { auth, db } from '../../src/firebaseConfig';
import { geohashQueryBounds, distanceBetween } from 'geofire-common';

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
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [tollZones, setTollZones] = useState<TollZone[]>([]);
  const [loading, setLoading] = useState(true);
  
  // States for advanced geofencing logic
  const [physicallyInZone, setPhysicallyInZone] = useState<TollZone | null>(null); // For instant UI updates
  const [tripZone, setTripZone] = useState<TollZone | null>(null); // For background trip logic
  const [entryPoint, setEntryPoint] = useState<Location.LocationObject | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [pendingDeduction, setPendingDeduction] = useState<PendingDeduction | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('Searching...');

  // Refs for smoothing and timers
  const locationHistoryRef = useRef<Location.LocationObject[]>([]);
  const exitTimerRef = useRef<number | null>(null);
  // <-- NEW: Ref to track the last location where we fetched zones
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

   // Load any saved pending deduction 🔧
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

  // --- UPDATED: Effect for location tracking with Conditional Smoothing & Jump Detection ---
  useEffect(() => {
    let subscriber: Location.LocationSubscription | null = null;
    const startLocationTracking = async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("Permission Denied", "Location permission is required.");
        return;
      }
      subscriber = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 5 },
        (newLocation) => {
          
          // --- Start of Conditional Logic ---
          if (physicallyInZone) {
            // If INSIDE a zone, use RAW location for a fast exit.
            if (newLocation.coords.accuracy != null && newLocation.coords.accuracy < 75) {
              setLocation(newLocation);
            }
          } else {
            // If OUTSIDE a zone, use SMOOTHED location with JUMP DETECTION.
            
            // --- UPDATED: Jump Detection (Scenario 2) ---
            if (locationHistoryRef.current.length > 0) {
              const lastLocation = locationHistoryRef.current[locationHistoryRef.current.length - 1];
              const jumpDistance = getDistance(
                lastLocation.coords.latitude, lastLocation.coords.longitude,
                newLocation.coords.latitude, newLocation.coords.longitude
              );
              // <-- UPDATED: Changed from 500m to 100m to match your scenario
              if (jumpDistance > 100) { 
                console.warn(`GPS Jump detected (${jumpDistance.toFixed(0)}m). Resetting smoothing buffer.`);
                locationHistoryRef.current = [];
              }
            }
            
            // Smoothing Logic
            locationHistoryRef.current.push(newLocation);
            if (locationHistoryRef.current.length > 7) { 
              locationHistoryRef.current.shift();
            }
            const avgLat = locationHistoryRef.current.reduce((sum, loc) => sum + loc.coords.latitude, 0) / locationHistoryRef.current.length;
            const avgLng = locationHistoryRef.current.reduce((sum, loc) => sum + loc.coords.longitude, 0) / locationHistoryRef.current.length;
            const smoothedLocation = { ...newLocation, coords: { ...newLocation.coords, latitude: avgLat, longitude: avgLng } };
            
            if (newLocation.coords.accuracy != null && newLocation.coords.accuracy < 75) {
              setLocation(smoothedLocation);
            }
          }
          // --- End of Conditional Logic ---
        }
      );
    };
    startLocationTracking();
    return () => { if (subscriber) { subscriber.remove(); } };
  }, [physicallyInZone]); 

  // Effect to fetch toll zones (from Firestore)
  // --- UPDATED: This hook is now optimized for Scenario 2 ---
  useEffect(() => {
    // This function will be triggered whenever the user's location changes significantly
    const fetchNearbyTollZones = async (locationObject: Location.LocationObject) => {
        if (!locationObject) return;

        const center: [number, number] = [locationObject.coords.latitude, locationObject.coords.longitude];
        const radiusInM = 50 * 1000; // 50 kilometers

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

        const snapshots = await Promise.all(promises);
        const matchingDocs: TollZone[] = [];

        for (const snap of snapshots) {
            for (const doc of snap.docs) {
                const data = doc.data();
                const points = data.tollZones || data.coordinates;
                
                // --- FIX from previous error ---
                let zoneCenterArray: [number, number] | null = null;
                if (data.center && data.center.lat != null && data.center.lng != null) {
                    zoneCenterArray = [data.center.lat, data.center.lng];
                } else if (points && points.length > 0) {
                    zoneCenterArray = [points[0].lat, points[0].lng];
                }
                // --- End of Fix ---

                if (zoneCenterArray) {
                    const distanceInKm = distanceBetween(center, zoneCenterArray);
                    if (distanceInKm * 1000 <= radiusInM) {
                        matchingDocs.push({ id: doc.id, name: data.name, toll_amount: data.toll_amount, coordinates: points });
                    }
                }
            }
        }
        setTollZones(matchingDocs);
        // <-- NEW: Update the ref so we know the location of the last successful fetch
        lastZoneFetchLocationRef.current = locationObject;
    };

    // --- NEW: Logic for Scenario 2 (Efficient Fetching) ---
    if (location) {
        const FETCH_THRESHOLD_METERS = 500; // Only fetch new zones if user moves 500m
        
        if (!lastZoneFetchLocationRef.current) {
            // Case 1: First time loading, fetch immediately
            console.log("First time fetching nearby zones.");
            fetchNearbyTollZones(location);
        } else {
            // Case 2: Check distance from last fetch
            const distanceMoved = getDistance(
              lastZoneFetchLocationRef.current.coords.latitude,
              lastZoneFetchLocationRef.current.coords.longitude,
              location.coords.latitude,
              location.coords.longitude
            );
            
            if (distanceMoved > FETCH_THRESHOLD_METERS) {
              console.log(`User moved ${distanceMoved.toFixed(0)}m. Fetching new zones.`);
              fetchNearbyTollZones(location);
            }
            // Else: User hasn't moved far enough. Do nothing.
        }
    }
  }, [location]); // This effect still runs on location change, but now has an internal check

  // Effect that ONLY determines the physical zone status for the UI
  useEffect(() => {
    if (!location || tollZones.length === 0) return;
    const currentLocation: Point = { lat: location.coords.latitude, lng: location.coords.longitude };
    let currentZone: TollZone | null = null;
    for (const zone of tollZones) {
      if (isPointInPolygon(currentLocation, zone.coordinates)) {
        currentZone = zone;
        break;
      }
    }
    setPhysicallyInZone(currentZone);
  }, [location, tollZones]);

  // Effect that manages the trip logic (entry, exit, and grace period) - (Scenario 1)
  useEffect(() => {
    if (physicallyInZone) {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      if (!tripZone) {
        setTripZone(physicallyInZone);
        setEntryPoint(location);
      }
    } else if (!physicallyInZone && tripZone) {
      if (!exitTimerRef.current) {
        const exitLocation = location;
        const timerId = setTimeout(() => {
          calculateAndChargeToll(entryPoint, exitLocation, tripZone);
          setTripZone(null);
          setEntryPoint(null);
          exitTimerRef.current = null;
        }, 20000);
        exitTimerRef.current = Number(timerId);
      }
    }
  }, [physicallyInZone]); // <-- This dependency array is correct

  // Effect for pending deductions
  useEffect(() => {
    const processPending = async () => {
      if (pendingDeduction && walletBalance && !isOffline) {
        const { entry, exit, zone } = pendingDeduction;
        const distanceMeters = getDistance(
          entry.coords.latitude,
          entry.coords.longitude,
          exit.coords.latitude,
          exit.coords.longitude
        );
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
     
  // Effect for Live GPS Service Monitoring
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
      } else if (location) {
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
  }, [location]); 

  // Effect for Hybrid GPS-to-ANPR Handover (Scenario 4)
  useEffect(() => {
    if (!auth.currentUser) return;
    const userDocRef = doc(db, "users", auth.currentUser.uid);
    
    updateDoc(userDocRef, {
      gpsStatusInZone: physicallyInZone ? gpsStatus : 'not needed'
    });

    if (physicallyInZone && gpsStatus === 'Disconnected' && location) {
      Alert.alert(
        "GPS Signal Lost",
        "Your device's location was turned off. Tolls will now be calculated using cameras as a fallback.",
        [{ text: "OK" }]
      );
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
            console.log(`GPS lost: Saving last known location to trip ${activeTripDoc.id}`);
            
            await updateDoc(tripDocRef, {
              lastKnownGGpsLocation: {
                lat: location.coords.latitude,
                lng: location.coords.longitude,
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
  }, [physicallyInZone, gpsStatus, location]);
  
  // Effect to listen for network changes
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

  // Function to sync offline transactions
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

  // Main toll calculation function (Scenario 1)
  const calculateAndChargeToll = async (entry: Location.LocationObject | null, exit: Location.LocationObject | null, zone: TollZone | null) => {
    if (!entry || !exit || !zone || !auth.currentUser) return;
    const distanceMeters = getDistance(entry.coords.latitude, entry.coords.longitude, exit.coords.latitude, exit.coords.longitude);
    const ratePerMeter = 50 / 20;
    const calculatedToll = Math.max(0, Math.round(distanceMeters * ratePerMeter));
    const userId = auth.currentUser.uid;
    
    if (isOffline) {
      // --- OFFLINE LOGIC ---
      Alert.alert(
        "Offline: Toll Saved", 
        `You traveled ${distanceMeters.toFixed(0)}m. A toll of ₹${calculatedToll.toFixed(2)} will be deducted when you reconnect to the internet.`
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
      // --- ONLINE LOGIC ---
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
      await addDoc(collection(db, "transactions"), { userId, zoneId: zone.id, zoneName: zone.name, amount: calculatedToll, distance: `${distanceMeters.toFixed(0)}m`, type: 'debit', timestamp: serverTimestamp() });
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