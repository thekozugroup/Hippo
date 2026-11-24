package io.github.thekozugroup.hippo;

/**
 * The share waiting for the web app, and the rules for what counts as a new share. Plain Java
 * (no Android types) so it is unit tested on the JVM; SharedTextPlugin feeds it from intents.
 *
 * Only the latest share is kept: a second share before the web app took the first replaces it.
 * Every share gets a number that only grows, so the web app can ignore an answer older than one
 * it already used.
 */
final class ShareInbox {

    /** Longest title or text passed on, in characters. The web app's own limits are lower. */
    static final int MAX_CHARS = 4096;
    /** Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY: Android started the activity again from Recents. */
    static final int FLAG_LAUNCHED_FROM_HISTORY = 0x00100000;

    /** A text share: both parts capped, at least one present. */
    static final class Share {
        final String title;
        final String text;
        final long seq;

        Share(String title, String text, long seq) {
            this.title = title;
            this.text = text;
            this.seq = seq;
        }
    }

    private Share pending;
    private long lastSeq;

    /** Keeps a share for the web app, replacing any older one. Returns false (and keeps nothing) when it holds nothing usable. */
    synchronized boolean put(CharSequence title, CharSequence text) {
        String t = cap(title);
        String x = cap(text);
        if (t == null && x == null) return false;
        pending = new Share(t, x, ++lastSeq);
        return true;
    }

    /** Returns the waiting share and forgets it; null when there is none. */
    synchronized Share take() {
        Share out = pending;
        pending = null;
        return out;
    }

    /** Whether an intent is a text share from another app (ACTION_SEND with a text/* type). */
    static boolean isTextShare(String action, String type) {
        return "android.intent.action.SEND".equals(action) && type != null && type.startsWith("text/");
    }

    /**
     * Whether the intent the activity was created with is one Android hands back again rather than
     * a new share: the activity was recreated from saved state (after the process was stopped in
     * the background, or a configuration change), or reopened from Recents. Its share was already
     * used by the earlier instance, so it must not open Add a wish a second time.
     */
    static boolean isRedelivery(int intentFlags, boolean restoredFromSavedState) {
        return restoredFromSavedState || (intentFlags & FLAG_LAUNCHED_FROM_HISTORY) != 0;
    }

    /** The value as a string of at most MAX_CHARS characters, without cutting a surrogate pair; null when blank. */
    static String cap(CharSequence value) {
        if (value == null) return null;
        String s = value.toString();
        if (s.trim().isEmpty()) return null;
        if (s.length() <= MAX_CHARS) return s;
        int end = Character.isHighSurrogate(s.charAt(MAX_CHARS - 1)) ? MAX_CHARS - 1 : MAX_CHARS;
        return s.substring(0, end);
    }
}
