import { FontAwesome5 } from '@expo/vector-icons';
import { doc, onSnapshot } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../../src/firebaseConfig';

type UserProfile = {
  name: string;
  email: string;
  vehicleNumber: string;
  rcNumber: string;
};

const ProfileScreen = () => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth.currentUser) {
      const userDocRef = doc(db, "users", auth.currentUser.uid);
      const unsubscribe = onSnapshot(userDocRef, (doc) => {
        if (doc.exists()) {
          setProfile(doc.data() as UserProfile);
        }
        setLoading(false);
      });
      return () => unsubscribe();
    }
  }, []);

  const handleSignOut = () => {
    Alert.alert(
      "Sign Out",
      "Are you sure you want to sign out?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "OK", onPress: () => auth.signOut() }
      ]
    );
  };

  if (loading) {
    return <ActivityIndicator size="large" style={styles.loader} />;
  }

  return (
    <View style={styles.container}>
      {/* Profile Header */}
      <View style={styles.profileHeader}>
        <View style={styles.avatar}>
          <FontAwesome5 name="user-alt" size={40} color="#e5e7eb" />
        </View>
        <Text style={styles.userName}>{profile?.name}</Text>
        {/* The email has been removed from this section */}
      </View>

      {/* Information Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account Details</Text>
        <View style={styles.infoCard}>
          {/* Email is now the first item in this list */}
          <View style={styles.infoRow}>
            <FontAwesome5 name="envelope" size={20} color="#9ca3af" style={styles.infoIcon} />
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue}>{profile?.email}</Text>
          </View>
          <View style={styles.infoRow}>
            <FontAwesome5 name="car" size={20} color="#9ca3af" style={styles.infoIcon} />
            <Text style={styles.infoLabel}>Vehicle Number</Text>
            <Text style={styles.infoValue}>{profile?.vehicleNumber}</Text>
          </View>
          <View style={styles.infoRow}>
            <FontAwesome5 name="id-card" size={20} color="#9ca3af" style={styles.infoIcon} />
            <Text style={styles.infoLabel}>RC Number</Text>
            <Text style={styles.infoValue}>{profile?.rcNumber}</Text>
          </View>
        </View>
      </View>
      
      {/* Action Button */}
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutButtonText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827', padding: 20 },
  loader: { flex: 1, justifyContent: 'center', backgroundColor: '#111827' },
  profileHeader: {
    alignItems: 'center',
    marginTop: 60,
    marginBottom: 40,
  },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#374151',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
  },
  userName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  section: {
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9ca3af',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  infoCard: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  infoIcon: {
    width: 30,
  },
  infoLabel: {
    fontSize: 16,
    color: '#d1d5db',
  },
  infoValue: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '500',
    marginLeft: 'auto', // Pushes the value to the right
  },
  signOutButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 12,
    padding: 15,
    alignItems: 'center',
    marginTop: 'auto', // Pushes button to the bottom
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.5)',
  },
  signOutButtonText: {
    color: '#f87171',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default ProfileScreen;