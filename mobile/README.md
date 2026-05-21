# FitCore Mobile

React Native / Expo app for FitCore. Shares the same Express backend as the web app.

## Setup

```bash
cd mobile
npm install
cp .env.example .env   # set EXPO_PUBLIC_API_URL to your backend's LAN IP
```

## Development

```bash
npm start              # Start Expo dev server
```

Then use the Expo Go app on your phone (for screens that don't use HealthKit).
For HealthKit, you need a custom dev client:

```bash
eas build --platform ios --profile development
```

Install the resulting .ipa via TestFlight or direct install, then run:
```bash
npx expo start --dev-client
```

## Build for TestFlight

```bash
eas build --platform ios --profile preview
```

## Required assets

Place these in `assets/`:
- `icon.png` (1024×1024)
- `splash.png` (1284×2778)
- `adaptive-icon.png` (1024×1024)
- `fonts/Manrope-Regular.ttf`
- `fonts/Manrope-Medium.ttf`
- `fonts/Manrope-SemiBold.ttf`
- `fonts/Manrope-Bold.ttf`
- `fonts/Manrope-ExtraBold.ttf`

Download Manrope from https://fonts.google.com/specimen/Manrope

## Apple Health

HealthKit only works on physical iOS devices with a custom dev client or production build.
It will not work in Expo Go or the iOS Simulator.

The Settings screen handles:
1. Requesting HealthKit permissions
2. Syncing the last N days of heart rate + body weight into FitCore
3. Syncing happens on demand — tap "Sync Last N Days"
