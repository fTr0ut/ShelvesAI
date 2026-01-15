# Custom User Lists

Allow users to create curated lists like "Top 10 Horror Movies".

## Overview
- Lists limited to 10 items maximum
- Supports position/ordering with reorder functionality
- Visibility: private, friends, public
- Items can have optional notes

---

## Phase 1: Database

### Task 1.1: Create user_lists and user_list_items tables
- [x] Add `user_lists` table (id, user_id, name, description, visibility)
- [x] Add `user_list_items` table (list_id, collectable_id, position, notes)
- [x] Position constraint 1-10
- [x] Unique constraints on (list_id, collectable_id) and (list_id, position)
- [x] Add update trigger for user_lists

---

## Phase 2: Backend

### Task 2.1: Create lists.js queries
- [x] Create `api/database/queries/lists.js`
- [x] `listForUser(userId)` - List all lists
- [x] `getById` / `getForViewing` with visibility check
- [x] `create`, `update`, `remove` - CRUD for lists
- [x] `getItems`, `addItem`, `removeItem` - Item management
- [x] `reorderItems(listId, itemOrders)` - Reorder items

### Task 2.2: Create listsController.js
- [x] Create `api/controllers/listsController.js`
- [x] `listLists`, `createList`, `getList`, `updateList`, `deleteList`
- [x] `addListItem`, `removeListItem`, `reorderListItems`
- [x] Validate max 10 items per list

### Task 2.3: Create lists routes
- [x] Create `api/routes/lists.js`
- [x] Register routes in server.js

---

## Phase 3: Mobile UI

### Task 3.1: Add Lists tab to ProfileScreen
- [x] Add "Lists" tab after "Shelves"
- [x] Add lists state and loading
- [x] Render list cards with navigation to ListDetail

### Task 3.2: Create ListCreateScreen
- [x] Create `ListCreateScreen.js`
- [x] Name, description, visibility inputs
- [x] Create list via API
- [x] Navigate to ListDetail on success

### Task 3.3: Create ListDetailScreen  
- [x] Create `ListDetailScreen.js`
- [x] Display ordered items
- [x] Reorder with up/down buttons
- [x] Add items via search modal
- [x] Remove items
- [x] Edit name/description
- [x] Delete list

### Task 3.4: Register screens in navigation
- [x] Add ListCreate and ListDetail to App.js

---

## Verification
- [ ] Create a new list via Profile > Lists > Create New List
- [ ] Add items to list via search
- [ ] Reorder items with up/down buttons
- [ ] Verify max 10 item limit
- [ ] Edit list name/description
- [ ] Delete list
- [ ] Verify visibility settings work
