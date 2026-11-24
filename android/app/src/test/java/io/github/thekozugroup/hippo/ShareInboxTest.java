package io.github.thekozugroup.hippo;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The share inbox and its rules: which intents are shares, re-delivery, the latest share wins, caps. */
public class ShareInboxTest {

    @Test
    public void coldStartShareWaitsUntilTheWebAppTakesItOnce() {
        ShareInbox inbox = new ShareInbox();
        // BridgeActivity.load hands the start intent over before the web app runs.
        assertTrue(inbox.put("Red wool scarf", "https://shop.example/p/1"));
        ShareInbox.Share s = inbox.take();
        assertEquals("Red wool scarf", s.title);
        assertEquals("https://shop.example/p/1", s.text);
        // Taken once: the next take (another "received", a page reload) finds nothing.
        assertNull(inbox.take());
    }

    @Test
    public void aSecondShareBeforeTheFirstIsTakenReplacesIt() {
        ShareInbox inbox = new ShareInbox();
        inbox.put("First", "https://a.example/1");
        inbox.put("Second", "https://b.example/2");
        ShareInbox.Share s = inbox.take();
        assertEquals("Second", s.title);
        assertEquals("https://b.example/2", s.text);
        assertNull(inbox.take());
    }

    @Test
    public void shareNumbersOnlyGrow() {
        ShareInbox inbox = new ShareInbox();
        inbox.put(null, "one");
        long first = inbox.take().seq;
        inbox.put(null, "two");
        long second = inbox.take().seq;
        assertTrue(second > first);
    }

    @Test
    public void nothingUsableIsNotKept() {
        ShareInbox inbox = new ShareInbox();
        assertFalse(inbox.put(null, null));
        assertFalse(inbox.put("  ", "\n\t"));
        assertNull(inbox.take());
        // A blank share does not drop one that is waiting.
        inbox.put("Kept", null);
        assertFalse(inbox.put("", ""));
        assertEquals("Kept", inbox.take().title);
    }

    @Test
    public void onlyTextSendIntentsAreShares() {
        assertTrue(ShareInbox.isTextShare("android.intent.action.SEND", "text/plain"));
        assertTrue(ShareInbox.isTextShare("android.intent.action.SEND", "text/html"));
        assertFalse(ShareInbox.isTextShare("android.intent.action.SEND", "image/png"));
        assertFalse(ShareInbox.isTextShare("android.intent.action.SEND", null));
        assertFalse(ShareInbox.isTextShare("android.intent.action.MAIN", "text/plain"));
        assertFalse(ShareInbox.isTextShare("android.intent.action.VIEW", null));
        assertFalse(ShareInbox.isTextShare(null, "text/plain"));
    }

    @Test
    public void aRecreatedOrRecentsLaunchedActivityDoesNotUseItsOldShareAgain() {
        // A fresh share: no saved state, not from Recents (FLAG_ACTIVITY_NEW_TASK only).
        assertFalse(ShareInbox.isRedelivery(0x10000000, false));
        // The process was stopped in the background and the activity is recreated from saved state.
        assertTrue(ShareInbox.isRedelivery(0x10000000, true));
        // Reopened from Recents after the task was started by a share.
        assertTrue(ShareInbox.isRedelivery(0x10000000 | ShareInbox.FLAG_LAUNCHED_FROM_HISTORY, false));
    }

    @Test
    public void theFlagMatchesAndroids() {
        assertEquals(android.content.Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY, ShareInbox.FLAG_LAUNCHED_FROM_HISTORY);
    }

    @Test
    public void longValuesAreCappedWithoutSplittingASurrogatePair() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < ShareInbox.MAX_CHARS - 1; i++) sb.append('a');
        sb.append("🦛"); // a hippo emoji straddling the limit
        sb.append("tail");
        String capped = ShareInbox.cap(sb);
        assertEquals(ShareInbox.MAX_CHARS - 1, capped.length());
        assertFalse(Character.isHighSurrogate(capped.charAt(capped.length() - 1)));
        assertEquals("short", ShareInbox.cap("short"));
        assertNull(ShareInbox.cap(null));
        assertNull(ShareInbox.cap("   "));
    }
}
