package io.github.thekozugroup.hippo;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** "Open in the Hippo app": which hippo:// addresses pass, and that everything else opens Home. */
public class OpenRouteTest {

    private static final String PAYLOAD = "AaoSdRv2qL_BwIuTHzKr-24jPw4kQwejV2KnSdnV1Qy2h7D8Z4TksfA5zKUHctWzosoMr_GnpMTG1tXdkkeG_0M";

    @Test
    public void destinationsPass() {
        assertEquals("/", OpenRoute.routeOf("hippo://open/"));
        assertEquals("/", OpenRoute.routeOf("hippo://open"));
        assertEquals("/wishlist", OpenRoute.routeOf("hippo://open/wishlist"));
        assertEquals("/lists", OpenRoute.routeOf("hippo://open/lists"));
        assertEquals("/settings", OpenRoute.routeOf("hippo://open/settings"));
        assertEquals("/lists", OpenRoute.routeOf("HIPPO://OPEN/lists"));
    }

    @Test
    public void listAndTransferRoutesPassWithAValidPayload() {
        assertEquals("/l/" + PAYLOAD, OpenRoute.routeOf("hippo://open/l/" + PAYLOAD));
        assertEquals("/t/" + PAYLOAD, OpenRoute.routeOf("hippo://open/t/" + PAYLOAD));
    }

    @Test
    public void anythingElseOpensHome() {
        assertEquals("/", OpenRoute.routeOf("hippo://open/item/new"));
        assertEquals("/", OpenRoute.routeOf("hippo://open/l/"));
        assertEquals("/", OpenRoute.routeOf("hippo://open/l/abc/def"));
        assertEquals("/", OpenRoute.routeOf("hippo://open/l/abc%2F..%2Fx"));
        assertEquals("/", OpenRoute.routeOf("hippo://open/l/abc def"));
        assertEquals("/", OpenRoute.routeOf("hippo://open/g/" + PAYLOAD));
        assertEquals("/", OpenRoute.routeOf("hippo://open/wishlist?x=1"));
        assertEquals("/", OpenRoute.routeOf("hippo://open/wishlist#x"));
        assertEquals("/", OpenRoute.routeOf("hippo://evil.example/wishlist"));
        assertEquals("/", OpenRoute.routeOf("hippo://user@open/wishlist"));
        assertEquals("/", OpenRoute.routeOf("hippo://open:80/wishlist"));
        assertEquals("/", OpenRoute.routeOf("hippo:open/wishlist"));
        assertEquals("/", OpenRoute.routeOf("hippo://open/javascript:alert(1)"));
        StringBuilder longPayload = new StringBuilder("hippo://open/l/");
        for (int i = 0; i < 4097; i++) longPayload.append('a');
        assertEquals("/", OpenRoute.routeOf(longPayload.toString()));
    }

    @Test
    public void otherAddressesAreNotHippoOnes() {
        assertNull(OpenRoute.routeOf(null));
        assertNull(OpenRoute.routeOf("https://owner.github.io/Hippo/#/l/" + PAYLOAD));
        assertNull(OpenRoute.routeOf("intent://open/#Intent;scheme=hippo;end"));
        assertFalse(OpenRoute.isHippoAddress("hippopotamus://open/"));
        assertTrue(OpenRoute.isHippoAddress("Hippo://open/"));
    }

    @Test
    public void theWebAppGetsACanonicalAddress() {
        assertEquals("hippo://open/lists", OpenRoute.addressFor("/lists"));
        assertEquals("hippo://open/", OpenRoute.addressFor("/nope"));
        assertEquals("hippo://open/l/" + PAYLOAD, OpenRoute.addressFor("/l/" + PAYLOAD));
    }
}
