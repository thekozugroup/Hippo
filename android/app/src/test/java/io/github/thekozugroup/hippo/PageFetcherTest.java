package io.github.thekozugroup.hippo;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

/** The page fetcher's address rules, without any network: names resolve through a fake resolver. */
public class PageFetcherTest {

    private static InetAddress ip(String literal) throws Exception {
        return InetAddress.getByName(literal);
    }

    private static PageFetcher.Resolver resolvesTo(String... literals) {
        return host -> {
            InetAddress[] out = new InetAddress[literals.length];
            for (int i = 0; i < literals.length; i++) {
                try {
                    out[i] = ip(literals[i]);
                } catch (Exception e) {
                    throw new AssertionError(e);
                }
            }
            return out;
        };
    }

    private static String failure(String url, PageFetcher.Resolver r) throws Exception {
        try {
            PageFetcher.check(new URL(url), r);
            return null;
        } catch (PageFetcher.Failure f) {
            return f.code;
        }
    }

    @Test
    public void publicAddresses() throws Exception {
        assertTrue(PageFetcher.isPublicAddress(ip("93.184.216.34")));
        assertTrue(PageFetcher.isPublicAddress(ip("2606:2800:220:1:248:1893:25c8:1946")));
    }

    @Test
    public void privateAndReservedAddresses() throws Exception {
        String[] blocked = {
            "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
            "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "192.0.0.8", "198.18.0.1",
            "::1", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:10.0.0.1", "2002:a00:1::1", "2001:db8::1",
        };
        for (String b : blocked) assertFalse(b, PageFetcher.isPublicAddress(ip(b)));
    }

    @Test
    public void hostNames() {
        assertTrue(PageFetcher.isPublicHostName("shop.example.com"));
        assertTrue(PageFetcher.isPublicHostName("example.com."));
        assertFalse(PageFetcher.isPublicHostName("localhost"));
        assertFalse(PageFetcher.isPublicHostName("printer.local"));
        assertFalse(PageFetcher.isPublicHostName("router.home.arpa"));
        assertFalse(PageFetcher.isPublicHostName("intranet"));
        assertFalse(PageFetcher.isPublicHostName("192.168.0.1"));
        assertFalse(PageFetcher.isPublicHostName("[::1]"));
        assertFalse(PageFetcher.isPublicHostName(""));
    }

    @Test
    public void checkRefusesWhatMustNotBeFetched() throws Exception {
        PageFetcher.Resolver ok = resolvesTo("93.184.216.34");
        assertEquals(null, failure("https://shop.example.com/p/1", ok));
        assertEquals("blocked", failure("http://shop.example.com/p/1", ok));
        assertEquals("blocked", failure("https://user:pass@shop.example.com/", ok));
        assertEquals("blocked", failure("https://shop.example.com:8443/", ok));
        assertEquals("blocked", failure("https://localhost/", ok));
        assertEquals("blocked", failure("https://10.0.0.1/", ok));
        // A public name that resolves to a private address (or to any private address among several).
        assertEquals("blocked", failure("https://shop.example.com/", resolvesTo("10.0.0.5")));
        assertEquals("blocked", failure("https://shop.example.com/", resolvesTo("93.184.216.34", "127.0.0.1")));
    }

    @Test
    public void fetchRefusesBeforeConnecting() {
        try {
            PageFetcher.fetch("https://shop.example.com/", 1000, 1024, null, null, resolvesTo("192.168.1.10"));
            fail("expected a refusal");
        } catch (PageFetcher.Failure f) {
            assertEquals("blocked", f.code);
        }
        try {
            PageFetcher.fetch("not a url", 1000, 1024, null, null, resolvesTo("93.184.216.34"));
            fail("expected a refusal");
        } catch (PageFetcher.Failure f) {
            assertEquals("blocked", f.code);
        }
    }

    @Test
    public void contentTypes() {
        assertTrue(PageFetcher.isHtml("text/html; charset=utf-8"));
        assertTrue(PageFetcher.isHtml("application/xhtml+xml"));
        assertFalse(PageFetcher.isHtml("application/json"));
        assertTrue(PageFetcher.isJson("application/json; charset=utf-8"));
        assertFalse(PageFetcher.isJson("text/html"));
        assertFalse(PageFetcher.isHtml("image/jpeg"));
        assertFalse(PageFetcher.isHtml(null));
        assertEquals(StandardCharsets.ISO_8859_1, PageFetcher.charsetOf("text/html; charset=ISO-8859-1"));
        assertEquals(StandardCharsets.UTF_8, PageFetcher.charsetOf("text/html; charset=no-such-charset"));
        assertEquals(StandardCharsets.UTF_8, PageFetcher.charsetOf("text/html"));
    }

    @Test
    public void hapticConstants() {
        assertEquals(-1, TouchFeedbackPlugin.constantFor("anything else", 34));
        assertEquals(-1, TouchFeedbackPlugin.constantFor(null, 34));
        assertTrue(TouchFeedbackPlugin.constantFor("confirm", 24) >= 0);
        assertTrue(TouchFeedbackPlugin.constantFor("toggle", 34) >= 0);
        assertTrue(TouchFeedbackPlugin.constantFor("warning", 30) >= 0);
    }
}
