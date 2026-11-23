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
 * (cold start, from BridgeActivity.load) and later ones (the app already
 * running, launchMode singleTask). Either way the share is kept here until
 * the web app takes it (src/app/native/shell.ts calls take() at start and
 * whenever "received" fires). The values are untrusted; they are only capped
 * here, and the web app validates them like a deep link. Nothing is logged.
 */
@CapacitorPlugin(name = "SharedText")
public class SharedTextPlugin extends Plugin {

    /** Longest title or text passed on, in characters. The web app's own limits are lower. */
    static final int MAX_CHARS = 4096;
    /** Marks an intent already read, so a recreated activity does not open the form again. */
    static final String CONSUMED = "io.github.thekozugroup.hippo.SHARE_CONSUMED";

    private JSObject pending;

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        JSObject share = read(intent);
        if (share == null) return;
        intent.putExtra(CONSUMED, true);
        synchronized (this) {
            pending = share;
        }
        notifyListeners("received", new JSObject());
    }

    /** Returns the waiting share (title and text, both optional) and forgets it. */
    @PluginMethod
    public void take(PluginCall call) {
        JSObject share;
        synchronized (this) {
            share = pending;
            pending = null;
        }
        call.resolve(share == null ? new JSObject() : share);
    }

    /** The title and text of a text share, capped; null for any other intent. */
    static JSObject read(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return null;
        if (intent.getBooleanExtra(CONSUMED, false)) return null;
        String type = intent.getType();
        if (type == null || !type.startsWith("text/")) return null;
        String text = cap(intent.getCharSequenceExtra(Intent.EXTRA_TEXT));
        String title = cap(intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT));
        if (title == null) title = cap(intent.getCharSequenceExtra(Intent.EXTRA_TITLE));
        if (text == null && title == null) return null;
        JSObject out = new JSObject();
        if (title != null) out.put("title", title);
        if (text != null) out.put("text", text);
        return out;
    }

    static String cap(CharSequence value) {
        if (value == null) return null;
        String s = value.toString();
        if (s.trim().isEmpty()) return null;
        if (s.length() <= MAX_CHARS) return s;
        // Do not cut a surrogate pair in half.
        int end = Character.isHighSurrogate(s.charAt(MAX_CHARS - 1)) ? MAX_CHARS - 1 : MAX_CHARS;
        return s.substring(0, end);
    }
}
