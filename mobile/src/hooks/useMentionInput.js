import { useCallback, useContext, useRef, useState } from 'react';
import { AuthContext } from '../context/AuthContext';
import { apiRequest } from '../services/api';

/**
 * Hook for @mention detection in comment TextInputs.
 *
 * Monitors text changes, detects when the user types '@', fetches and caches
 * the accepted friends list, and filters suggestions as the user continues typing.
 *
 * Usage:
 *   const mention = useMentionInput();
 *   // Pass mention.handleTextChange to onChangeText
 *   // Pass mention.handleSelectionChange to onSelectionChange
 *   // Render <MentionSuggestions> with mention.suggestions, mention.showSuggestions
 *   // On suggestion tap: const newText = mention.selectMention(friend, currentText);
 */
export function useMentionInput() {
  const { token, apiBase } = useContext(AuthContext);

  const [mentionQuery, setMentionQuery] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);

  const friendsCacheRef = useRef(null);
  const cursorPositionRef = useRef(0);
  const loadingRef = useRef(false);

  /**
   * Fetch accepted friends list from API, map to flat friend objects, cache in ref.
   */
  const loadFriends = useCallback(async () => {
    if (loadingRef.current) return friendsCacheRef.current;
    if (friendsCacheRef.current) return friendsCacheRef.current;

    loadingRef.current = true;
    setLoading(true);
    try {
      const data = await apiRequest({
        apiBase,
        path: '/api/friends?limit=200',
        token,
      });

      const friends = (data?.friendships || [])
        .filter(f => f.status === 'accepted')
        .map(f => f.isRequester ? f.addressee : f.requester);

      friendsCacheRef.current = friends;
      return friends;
    } catch (err) {
      if (__DEV__) console.warn('useMentionInput: failed to load friends', err);
      return [];
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [apiBase, token]);

  /**
   * Filter cached friends by a query string (matches username or name prefix).
   */
  const filterFriends = useCallback((friends, query) => {
    if (!friends || !friends.length) return [];
    if (!query) return friends.slice(0, 20);

    const lower = query.toLowerCase();
    return friends.filter(f => {
      const username = (f.username || '').toLowerCase();
      const name = (f.name || '').toLowerCase();
      return username.startsWith(lower) || name.startsWith(lower);
    }).slice(0, 20);
  }, []);

  /**
   * Find the current @mention context by scanning backward from the cursor.
   * Returns the query string after @ if in mention mode, or null otherwise.
   */
  const extractMentionQuery = useCallback((text, cursorPos) => {
    if (!text || cursorPos <= 0) return null;

    // Scan backward from cursor to find @
    const beforeCursor = text.slice(0, cursorPos);
    const atIndex = beforeCursor.lastIndexOf('@');
    if (atIndex < 0) return null;

    // @ must be at start of text or preceded by whitespace/newline/(
    if (atIndex > 0) {
      const charBefore = beforeCursor[atIndex - 1];
      if (!/[\s(]/.test(charBefore)) return null;
    }

    // Text between @ and cursor must not contain spaces (that would end the mention)
    const queryPart = beforeCursor.slice(atIndex + 1);
    if (/\s/.test(queryPart)) return null;

    return queryPart;
  }, []);

  /**
   * Handle text changes from the TextInput.
   * Call this from onChangeText alongside your own state setter.
   */
  const handleTextChange = useCallback(async (text) => {
    const cursorPos = cursorPositionRef.current;
    // Use text length as fallback cursor position when typing appends to end
    const effectiveCursor = cursorPos <= (text?.length || 0) ? cursorPos : (text?.length || 0);
    // After typing, cursor is typically at the end of new text
    const pos = Math.max(effectiveCursor, text?.length || 0);

    const query = extractMentionQuery(text, pos);

    if (query === null) {
      if (showSuggestions) {
        setMentionQuery(null);
        setSuggestions([]);
        setShowSuggestions(false);
      }
      return;
    }

    setMentionQuery(query);

    // Load friends on first @ trigger
    let friends = friendsCacheRef.current;
    if (!friends) {
      friends = await loadFriends();
    }

    const filtered = filterFriends(friends || [], query);
    setSuggestions(filtered);
    setShowSuggestions(true);
  }, [extractMentionQuery, filterFriends, loadFriends, showSuggestions]);

  /**
   * Track cursor position from TextInput onSelectionChange.
   */
  const handleSelectionChange = useCallback((event) => {
    const { start } = event?.nativeEvent?.selection || {};
    if (typeof start === 'number') {
      cursorPositionRef.current = start;
    }
  }, []);

  /**
   * Insert the selected friend's @username into the text.
   * Replaces the @query with @username followed by a space.
   * Returns the new text string — caller is responsible for setting state.
   */
  const selectMention = useCallback((friend, currentText) => {
    if (!friend || !currentText) {
      setShowSuggestions(false);
      setMentionQuery(null);
      setSuggestions([]);
      return currentText || '';
    }

    const cursorPos = cursorPositionRef.current;
    const pos = Math.max(cursorPos, currentText.length);
    const beforeCursor = currentText.slice(0, pos);
    const afterCursor = currentText.slice(pos);

    // Find the @ that started this mention
    const atIndex = beforeCursor.lastIndexOf('@');
    if (atIndex < 0) {
      setShowSuggestions(false);
      return currentText;
    }

    const beforeAt = currentText.slice(0, atIndex);
    const insertion = `@${friend.username} `;
    const newText = beforeAt + insertion + afterCursor;

    // Update cursor position to after the inserted mention
    cursorPositionRef.current = atIndex + insertion.length;

    setShowSuggestions(false);
    setMentionQuery(null);
    setSuggestions([]);

    return newText;
  }, []);

  /**
   * Dismiss the suggestions overlay.
   */
  const dismissSuggestions = useCallback(() => {
    setShowSuggestions(false);
    setMentionQuery(null);
    setSuggestions([]);
  }, []);

  return {
    mentionQuery,
    suggestions,
    showSuggestions,
    loading,
    handleTextChange,
    handleSelectionChange,
    selectMention,
    dismissSuggestions,
  };
}

/**
 * Parse text into segments, splitting on @username mentions.
 * Returns an array of { text, isMention } objects for styled rendering.
 */
export function parseMentionSegments(text) {
  if (!text) return [{ text: '', isMention: false }];

  const regex = /(?:^|[\s(])(@[a-zA-Z0-9_]+)/g;
  const segments = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // match[1] is the @username, match[0] may include a leading space/paren
    const mentionStr = match[1];
    const mentionStart = match.index + match[0].indexOf(mentionStr);

    if (mentionStart > lastIndex) {
      segments.push({ text: text.slice(lastIndex, mentionStart), isMention: false });
    }
    segments.push({ text: mentionStr, isMention: true });
    lastIndex = mentionStart + mentionStr.length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isMention: false });
  }

  if (segments.length === 0) {
    segments.push({ text, isMention: false });
  }

  return segments;
}
