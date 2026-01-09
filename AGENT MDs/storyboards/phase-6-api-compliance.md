# Phase 6: Catalog API Compliance

## Overview
**Goal**: Ensure compliance with catalog API terms of service before launching paid features. Add required attribution and prepare for commercial licensing.  
**Duration**: ~2-3 hours  
**Prerequisites**: All other phases complete

---

## Task 6.1: Add Open Library User-Agent
**Priority**: 🔴 Critical | **Time**: 20 min

**Modify**: `api/services/openLibrary.js`

Add User-Agent header to all requests:
```javascript
const USER_AGENT = 'ShelvesAI/1.0 (johnandrewnichols@gmail.com)';

const headers = {
  'User-Agent': USER_AGENT,
};

// Apply to all fetch calls
const response = await fetch(url, { headers });
```

**Acceptance Criteria**:
- [ ] User-Agent added to Open Library requests
- [ ] Contact email included

---

## Task 6.2: Add Attribution Screen
**Priority**: 🔴 Critical | **Time**: 45 min

**Create**: `mobile/src/screens/AboutScreen.js`

```javascript
import React from 'react';
import { ScrollView, Text, View, Linking, Image, StyleSheet } from 'react-native';

export default function AboutScreen() {
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>ShelvesAI</Text>
      <Text style={styles.version}>Version 1.0.0</Text>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data Sources</Text>
        
        <View style={styles.attribution}>
          <Text style={styles.serviceName}>Books</Text>
          <Text>Data provided by Open Library</Text>
          <Text 
            style={styles.link}
            onPress={() => Linking.openURL('https://openlibrary.org')}>
            openlibrary.org
          </Text>
        </View>
        
        <View style={styles.attribution}>
          <Text style={styles.serviceName}>Movies & TV</Text>
          <Text>This product uses the TMDB API but is not endorsed or certified by TMDB.</Text>
          {/* Add TMDB logo here */}
          <Text 
            style={styles.link}
            onPress={() => Linking.openURL('https://themoviedb.org')}>
            themoviedb.org
          </Text>
        </View>
        
        <View style={styles.attribution}>
          <Text style={styles.serviceName}>Video Games</Text>
          <Text>Game data provided by IGDB.com</Text>
          <Text 
            style={styles.link}
            onPress={() => Linking.openURL('https://igdb.com')}>
            igdb.com
          </Text>
        </View>
      </View>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Contact</Text>
        <Text>support@yourapp.com</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 24, fontWeight: 'bold' },
  version: { color: '#666', marginBottom: 24 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  attribution: { marginBottom: 16 },
  serviceName: { fontWeight: '600' },
  link: { color: '#007AFF' },
});
```

**Add to navigation**: `mobile/src/App.js`
```javascript
<Stack.Screen name="About" component={AboutScreen} options={{ title: 'About' }} />
```

**Acceptance Criteria**:
- [ ] About screen created
- [ ] All data sources attributed
- [ ] TMDB disclaimer included
- [ ] Links work

---

## Task 6.3: Add TMDB Logo
**Priority**: 🟡 Medium | **Time**: 15 min

1. Download TMDB logo from [TMDB Brand Assets](https://www.themoviedb.org/about/logos-attribution)
2. Save to `mobile/assets/tmdb-logo.png`
3. Add to About screen

**TMDB Logo Requirements**:
- Do not modify color, aspect ratio, or rotation
- Less prominent than your app logo

---

## Task 6.4: Contact TMDB for Commercial License
**Priority**: 🔴 Critical (Pre-Launch) | **Time**: 30 min

**If app will have paid features**:

1. Email: sales@themoviedb.org
2. Include:
   - App name and description
   - How you use TMDB data
   - Expected user volume
   - Your country
3. Request commercial license quote (~$149/month as of 2025)

**Create tracking issue/note** with:
- Date contacted
- Response received
- License terms
- Renewal date

---

## Task 6.5: Apply for IGDB Commercial Partnership
**Priority**: 🔴 Critical (Pre-Launch) | **Time**: 30 min

**If app will have paid features**:

1. Go to [IGDB API page](https://api.igdb.com)
2. Apply for Commercial Partnership
3. Benefits include:
   - Higher rate limits
   - Automatic data dumps
   - PopScore access

**Required**:
- Add user-facing attribution to IGDB.com
- Comply with Twitch Developer Services Agreement

---

## Task 6.6: Review Discogs Restrictions
**Priority**: 🟡 Medium | **Time**: 30 min

**If adding music/vinyl support**:

**Safe to use (CC0 Data)**:
- Release titles, notes, dates
- Track listings, barcodes
- Artist names, credits

**Cannot use commercially (Restricted Data)**:
- Album artwork
- User-generated content
- Marketplace/pricing data

**Decision Options**:
1. Use only CC0 data (no album art)
2. Don't integrate Discogs for v1
3. Contact Discogs for clarification

---

## Task 6.7: Create API Compliance Checklist
**Priority**: 🟡 Medium | **Time**: 20 min

**Create**: `docs/api-compliance.md`

```markdown
# Catalog API Compliance

## Open Library
- [x] User-Agent header added
- [ ] No bulk scraping
- [ ] Using data dumps for large imports

## TMDB
- [x] Attribution in About screen
- [x] TMDB logo displayed correctly
- [ ] Commercial license obtained (required for paid features)
- License ID: _______________
- Renewal date: _______________

## IGDB
- [x] Attribution to IGDB.com
- [ ] Commercial partnership applied
- [ ] Rate limit: 4 req/sec respected
- Partnership status: _______________

## Discogs (if applicable)
- [ ] Only CC0 data used
- [ ] No Restricted Data in commercial features
```

---

## Task 6.8: Add Rate Limiting to Catalog Services
**Priority**: 🟡 Medium | **Time**: 1 hour

Ensure catalog services respect rate limits:

**TMDB**: ~40 requests/second max
**IGDB**: 4 requests/second max
**Open Library**: Be respectful, no hard limit

Add rate limiting wrapper if not present:
```javascript
class RateLimiter {
  constructor(maxRequests, perSeconds) {
    this.maxRequests = maxRequests;
    this.perSeconds = perSeconds;
    this.timestamps = [];
  }
  
  async acquire() {
    const now = Date.now();
    const windowStart = now - (this.perSeconds * 1000);
    this.timestamps = this.timestamps.filter(t => t > windowStart);
    
    if (this.timestamps.length >= this.maxRequests) {
      const waitTime = this.timestamps[0] - windowStart;
      await new Promise(r => setTimeout(r, waitTime));
    }
    
    this.timestamps.push(Date.now());
  }
}
```

---

## Completion Checklist
- [ ] Open Library User-Agent added
- [ ] About screen with attributions created
- [ ] TMDB logo added correctly
- [ ] TMDB contacted for commercial license
- [ ] IGDB partnership applied
- [ ] Discogs restrictions reviewed
- [ ] Compliance checklist documented
- [ ] Rate limiting verified
