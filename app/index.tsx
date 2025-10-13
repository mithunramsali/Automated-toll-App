import { Link } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';
import React, { useState } from 'react';
import { Alert, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { auth, db } from '../src/firebaseConfig';

const LoginScreen = () => {
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      // 1. Find the user document with the matching vehicle number
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("vehicleNumber", "==", vehicleNumber));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        throw new Error("No user found with this vehicle number.");
      }
      
      // 2. Get the email from that document
      const userDoc = querySnapshot.docs[0];
      const userEmail = userDoc.data().email;

      // 3. Sign in using the retrieved email and the provided password
      await signInWithEmailAndPassword(auth, userEmail, password);
      // Navigation is handled by the root layout
    } catch (error: any) {
      Alert.alert("Login Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome Back!</Text>
      <TextInput style={styles.input} placeholder="Vehicle Number" value={vehicleNumber} onChangeText={setVehicleNumber} autoCapitalize="characters" />
      <TextInput style={styles.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
      <Button title={loading ? "Logging in..." : "Login"} onPress={handleLogin} disabled={loading} />
      <Link href="/register" style={styles.link}>Don't have an account? Register</Link>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20 },
  input: { width: '100%', height: 40, borderColor: 'gray', borderWidth: 1, marginBottom: 15, paddingHorizontal: 10, borderRadius: 5 },
  link: { marginTop: 20, color: 'blue' },
});

export default LoginScreen;