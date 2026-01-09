import React from "react";
import { View, TouchableOpacity, Text, StyleSheet, Image } from "react-native";

const tabs = [
  { key: "home", label: "Home", icon: require("../assets/icons/home.png"), route: "Home" },
  { key: "shelves", label: "Shelves", icon: require("../assets/icons/book.png"), route: "Shelves" },
  { key: "account", label: "Profile", icon: require("../assets/icons/hamburger.png"), route: "Account" },
];

export default function FooterNav({ navigation, active }) {
  return (
    <View style={styles.wrapper}>
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, isActive && styles.activeTab]}
            onPress={() => navigation.navigate(tab.route)}
            activeOpacity={0.7}
          >
            <Image source={tab.icon} style={[styles.icon, isActive && styles.activeIcon]} />
            <Text style={[styles.label, isActive && styles.activeText]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingVertical: 25,
    borderTopWidth: 1,
    borderColor: "#223043",
    backgroundColor: "#0b1320",
  },
  tab: {
    alignItems: "center",
    gap: 2,
  },
  activeTab: {
    transform: [{ translateY: -2 }],
  },
  icon: {
    width: 24,
    height: 24,
    tintColor: "#9aa6b2",
  },
  activeIcon: {
    tintColor: "#7ca6ff",
  },
  label: {
    color: "#9aa6b2",
    fontSize: 12,
  },
  activeText: {
    color: "#7ca6ff",
  },
});
