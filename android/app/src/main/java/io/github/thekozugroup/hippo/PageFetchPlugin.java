package io.github.thekozugroup.hippo;

import android.webkit.WebSettings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * fetch({ url, timeoutMs, maxBytes }) for the web app's on-device page reader
 * (src/app/native/http.ts, src/core/services/page-metadata.ts). The rules are
 * in PageFetcher. Capacitor's own CapacitorHttp is not used for this because
 * it reads the whole response into memory and keeps cookies.
 */
@CapacitorPlugin(name = "PageFetch")
public class PageFetchPlugin extends Plugin {

    private final ExecutorService pool = Executors.newFixedThreadPool(2);
    private volatile String userAgent;

    @Override
    public void load() {
        super.load();
        try {
            // The phone's own browser engine string, so shops send their normal page.
            userAgent = WebSettings.getDefaultUserAgent(getContext());
        } catch (RuntimeException ignored) {
            userAgent = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        pool.shutdownNow();
    }

    static int clamp(Integer value, int fallback, int min, int max) {
        int v = value == null ? fallback : value;
        return Math.max(min, Math.min(max, v));
    }

    @PluginMethod
    public void fetch(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.length() > 4096) {
            call.reject("blocked", "blocked");
            return;
        }
        int timeoutMs = clamp(call.getInt("timeoutMs"), 8000, 1000, 15000);
        int maxBytes = clamp(call.getInt("maxBytes"), 1_500_000, 16 * 1024, 2_000_000);
        String language = Locale.getDefault().toLanguageTag();
        boolean json = "json".equals(call.getString("accept"));
        try {
            pool.execute(() -> {
                try {
                    PageFetcher.Page page = PageFetcher.fetch(url, timeoutMs, maxBytes, userAgent, language, PageFetcher.SYSTEM_RESOLVER, json);
                    JSObject out = new JSObject();
                    out.put("status", page.status);
                    out.put("url", page.url);
                    out.put("contentType", page.contentType);
                    out.put("body", page.body);
                    out.put("truncated", page.truncated);
                    call.resolve(out);
                } catch (PageFetcher.Failure f) {
                    call.reject(f.code, f.code);
                } catch (RuntimeException e) {
                    call.reject("network", "network");
                }
            });
        } catch (RuntimeException e) {
            call.reject("network", "network");
        }
    }
}
