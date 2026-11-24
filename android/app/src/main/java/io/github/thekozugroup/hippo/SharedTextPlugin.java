package io.github.thekozugroup.hippo;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Text that another app shared with Hippo through Android's Share
 * (ACTION_SEND, text/plain): usually a page title as the subject and the
 * page's link as the text.
 *
 * Capacitor hands every intent to plugins: the one that started the app
 * (cold start: BridgeActivity.load passes getIntent() before the web app has
 * loaded) and later ones (the app already running, launchMode singleTask,
 * through onNewIntent). Either way the share is kept in a ShareInbox until the
 * web app takes it: src/app/native/shell.ts calls take() when it starts and
 * whenever "received" fires, so a "received" sent before the web app listens
 * loses nothing. An intent Android hands back after recreating the activity is
 * marked by MainActivity and skipped here. The values are untrusted; they are
 * only capped here, and the web app validates them like a deep link. Nothing
 * is logged.
 */
@CapacitorPlugin(name = "SharedText")
public class SharedTextPlugin extends Plugin {

    /** Marks an intent already used, so it does not open the form again. */
    static final String CONSUMED = "io.github.thekozugroup.hippo.SHARE_CONSUMED";

    private final ShareInbox inbox = new ShareInbox();

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null || !ShareInbox.isTextShare(intent.getAction(), intent.getType())) return;
        if (intent.getBooleanExtra(CONSUMED, false)) return;
        CharSequence title = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
        if (ShareInbox.cap(title) == null) title = intent.getCharSequenceExtra(Intent.EXTRA_TITLE);
        if (!inbox.put(title, intent.getCharSequenceExtra(Intent.EXTRA_TEXT))) return;
        intent.putExtra(CONSUMED, true);
        notifyListeners("received", new JSObject());
    }

    /** Marks the activity's start intent as used when Android hands an old share back (see ShareInbox.isRedelivery). */
    static void skipRedelivered(Intent intent, boolean restoredFromSavedState) {
        if (intent == null || !ShareInbox.isTextShare(intent.getAction(), intent.getType())) return;
        if (ShareInbox.isRedelivery(intent.getFlags(), restoredFromSavedState)) intent.putExtra(CONSUMED, true);
    }

    /** Returns the waiting share (title and text, both optional, and its number `seq`) and forgets it. */
    @PluginMethod
    public void take(PluginCall call) {
        ShareInbox.Share share = inbox.take();
        JSObject out = new JSObject();
        if (share != null) {
            if (share.title != null) out.put("title", share.title);
            if (share.text != null) out.put("text", share.text);
            out.put("seq", share.seq);
        }
        call.resolve(out);
    }
}
