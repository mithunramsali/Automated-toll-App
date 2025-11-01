import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Link } from 'expo-router';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../src/firebaseConfig';

const RegisterScreen = () => {
  const [name, setName] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [rcNumber, setRcNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!name || !vehicleNumber || !rcNumber || !email || !password || !confirmPassword) {
      Alert.alert("Error", "Please fill in all fields.");
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert("Error", "Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      const userDocRef = doc(db, "users", user.uid);
      await setDoc(userDocRef, {
        name,
        vehicleNumber: vehicleNumber.toUpperCase(),
        rcNumber,
        email: email.toLowerCase(),
        walletBalance: 1000,
      });
      // Success, the root layout will navigate automatically
    } catch (error: any) {
      Alert.alert("Registration Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={['#111827', '#1f2937']} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Get started with your new account</Text>

        <View style={styles.inputContainer}>
          <FontAwesome5 name="user" size={16} color="#9ca3af" style={styles.icon} />
          <TextInput style={styles.input} placeholder="Full Name" placeholderTextColor="#9ca3af" value={name} onChangeText={setName} />
        </View>

        <View style={styles.inputContainer}>
          <FontAwesome5 name="car" size={16} color="#9ca3af" style={styles.icon} />
          <TextInput style={styles.input} placeholder="Vehicle Number" placeholderTextColor="#9ca3af" value={vehicleNumber} onChangeText={setVehicleNumber} autoCapitalize="characters" />
        </View>

        <View style={styles.inputContainer}>
          <FontAwesome5 name="id-card" size={16} color="#9ca3af" style={styles.icon} />
          <TextInput style={styles.input} placeholder="RC Number" placeholderTextColor="#9ca3af" value={rcNumber} onChangeText={setRcNumber} />
        </View>

        <View style={styles.inputContainer}>
          <FontAwesome5 name="envelope" size={16} color="#9ca3af" style={styles.icon} />
          <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#9ca3af" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        </View>

        <View style={styles.inputContainer}>
          <FontAwesome5 name="lock" size={16} color="#9ca3af" style={styles.icon} />
          <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#9ca3af" value={password} onChangeText={setPassword} secureTextEntry />
        </View>

        <View style={styles.inputContainer}>
          <FontAwesome5 name="lock" size={16} color="#9ca3af" style={styles.icon} />
          <TextInput style={styles.input} placeholder="Confirm Password" placeholderTextColor="#9ca3af" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
        </View>

        <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Register</Text>
          )}
        </TouchableOpacity>
        
        <Link href="/" asChild>
          <TouchableOpacity>
            <Text style={styles.linkText}>Already have an account? <Text style={styles.linkTextBold}>Login</Text></Text>
          </TouchableOpacity>
        </Link>
      </ScrollView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    paddingTop: 80, // Add padding for the top area
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#9ca3af',
    marginBottom: 40,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f2937',
    borderRadius: 12,
    width: '100%',
    marginBottom: 15,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: '#374151',
  },
  icon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: 50,
    color: '#fff',
  },
  button: {
    width: '100%',
    backgroundColor: '#4338ca',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  linkText: {
    color: '#9ca3af',
    marginTop: 20,
    marginBottom: 20,
  },
  linkTextBold: {
    fontWeight: 'bold',
    color: '#fff',
  }
});

export default RegisterScreen;