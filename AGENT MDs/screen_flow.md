# Mobile Application Screen Flow

This document outlines the navigation flow of the ShelvesAI mobile application.

## Overview

The application uses a Hybrid navigation strategy:
1.  **Bottom Tab Navigator**: The main interface for switching between major contexts (Home, Add, Shelves).
2.  **Native Stack Navigator**: Handles specific flows and detailed views pushed on top of the tabs.

## Navigation Structure

### 1. Startup & Authentication
- **LoginScreen**: Initial screen if no user token is found.
- **UsernameSetupScreen**: Shown after login if the user profile is incomplete.
- **AccountScreen**: Shown during onboarding to complete profile.

### 2. Main Navigation (Bottom Tabs)
Once authenticated, the user lands on the **Main** navigator which contains:

| Tab Name | Icon | Screen Component | Description |
| :--- | :--- | :--- | :--- |
| **Home** | `home` | `SocialFeedScreen` | The landing screen showing activity feed. |
| **Add** | `add` | `ShelfCreateScreen` | (Button) Opens the "New Shelf" screen directly (Modal-like behavior). |
| **Shelves** | `library` | `ShelvesScreen` | Users' personal collection of shelves. |

*Note: The "Add" tab is a custom button that intercepts the press to navigate to `ShelfCreateScreen` instead of switching tabs.*

### 3. Stack Screens (Global)
These screens can be accessed from multiple points in the app and overlay the current context:

*   **FeedDetail**: Detailed view of a feed item.
*   **FriendSearch**: Search for other users.
*   **ShelfCreate**: Screen to create a new shelf.
*   **ShelfDetail**: View contents of a specific shelf.
*   **ShelfEdit**: Modify shelf settings.
*   **CollectableDetail**: View details of an item in a shelf.
*   **ManualEdit**: Manually edit item metadata.
*   **Account**: User settings and profile management.
*   **About**: App information.

## Visual Flow Diagram

```mermaid
graph TD
    %% Nodes
    Login[Login Screen]
    Onboarding[Username/Account Setup]
    
    subgraph Tabs [Bottom Tab Navigator]
        Home[Home / SocialFeedScreen]
        Shelves[Shelves / ShelvesScreen]
    end
    
    subgraph Stack [Stack Screens]
        FeedDetail[Feed Detail]
        Account[Account Screen]
        FriendSearch[Friend Search]
        ShelfCreate[Shelf Create]
        ShelfDetail[Shelf Detail]
        ShelfEdit[Shelf Edit]
        ItemDetail[Collectable Detail]
        ManualEdit[Manual Edit]
        About[About]
    end

    %% Startup Flow
    Start((Start)) -->|No Token| Login
    Start -->|Token + Incomplete| Onboarding
    Start -->|Token + Complete| Home

    Login -->|Success| Home
    Onboarding -->|Complete| Home

    %% Tab Navigation
    Home <--> Shelves

    %% Home Tab Interactions
    Home -- Select Item --> FeedDetail
    Home -- Header Icon --> Account
    Home -- Search Users --> FriendSearch

    %% Shelves Tab Interactions
    Shelves -- Select Shelf --> ShelfDetail
    Shelves -- Header Icon --> Account

    %% Global Actions (e.g. Add Button)
    Tabs -- + Button --> ShelfCreate

    %% Shelf Flows
    ShelfCreate -->|Created| ShelfDetail
    ShelfDetail -- Edit Shelf --> ShelfEdit
    ShelfDetail -- Select Item --> ItemDetail
    ShelfEdit -->|Save| ShelfDetail

    %% Item Flows
    ItemDetail -- Edit --> ManualEdit
    ManualEdit -->|Save| ItemDetail

    %% Account Flows
    Account --> About
    Account -->|Logout| Login
```

## Detailed Interaction Map

### From Home (Feed)
- **Tap Feed Item** -> `FeedDetail`
- **Tap Profile Icon (Header)** -> `Account`

### From Shelves
- **Tap Shelf Card** -> `ShelfDetail`
- **Tap Profile Icon (Header)** -> `Account`

### From Global Add Button (Center Tab)
- **Tap (+)** -> `ShelfCreateScreen`

### From Details
- **ShelfDetail**
  - Tap Item -> `CollectableDetail`
  - Tap Options/Edit -> `ShelfEdit`
- **CollectableDetail**
  - Tap Edit -> `ManualEdit`
