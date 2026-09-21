let controllers = [];
let maxControllers = 4;
let debugEnabled = false;

// Used only for "NEW since previous scan".
let previousScanMacs = null;

// Long-lived browser-side knowledge cache.
// Key = BLE MAC address.
const deviceCache = new Map();

const MAX_CACHED_DEVICES = 100;
const MAX_PAYLOADS_PER_DEVICE = 8;

// Scan result ordering. "controllers-first" keeps every BLE device visible,
// but promotes likely game controllers above the rest.
let scanViewMode = "controllers-first";
let lastRenderedDevices = [];
let lastComparisonAvailable = false;


/* ============================================================
   ON-SCREEN DEBUG PANEL
   ============================================================ */

const debugLines = [];
const MAX_DEBUG_LINES = 120;

function ensureDebugPanel() {

    if (!debugEnabled) {
        return;
    }

    if (document.getElementById("scan-debug-panel")) {
        return;
    }

    const panel = document.createElement("div");
    panel.id = "scan-debug-panel";

    panel.style.marginTop = "18px";
    panel.style.padding = "12px";
    panel.style.border = "1px solid #444";
    panel.style.borderRadius = "8px";
    panel.style.background = "#161616";
    panel.style.color = "#d8d8d8";
    panel.style.fontFamily = "monospace";
    panel.style.fontSize = "12px";
    panel.style.lineHeight = "1.45";

    panel.innerHTML = `
        <div style="
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:12px;
            margin-bottom:8px;
        ">
            <strong>Scan Debug</strong>

            <div style="
                display:flex;
                gap:6px;
            ">
                <button
                    id="scan-debug-clear"
                    type="button"
                    class="secondary"
                    style="
                        padding:4px 8px;
                        font-size:12px;
                    "
                >
                    Clear
                </button>

                <button
                    id="scan-debug-copy"
                    type="button"
                    class="secondary"
                    style="
                        padding:4px 8px;
                        font-size:12px;
                    "
                >
                    Copy
                </button>
            </div>
        </div>

        <pre
            id="scan-debug-output"
            style="
                margin:0;
                max-height:260px;
                overflow:auto;
                white-space:pre-wrap;
                word-break:break-word;
            "
        ></pre>
    `;

    const scanResults =
        document.getElementById("scan-results");

    if (
        scanResults &&
        scanResults.parentNode
    ) {
        scanResults.parentNode.insertBefore(
            panel,
            scanResults.nextSibling
        );
    } else {
        document.body.appendChild(
            panel
        );
    }

    document.getElementById(
        "scan-debug-clear"
    ).addEventListener(
        "click",
        () => {
            debugLines.length = 0;
            renderDebugPanel();
        }
    );

    document.getElementById(
    "scan-debug-copy"
).addEventListener(
    "click",
    async () => {
        const text =
            debugLines.join("\n");

        if (!text) {
            toast(
                "Debug log is empty"
            );

            return;
        }

        let copied = false;

        // Modern clipboard API.
        if (
            navigator.clipboard &&
            window.isSecureContext
        ) {
            try {
                await navigator.clipboard.writeText(
                    text
                );

                copied = true;

            } catch {
                copied = false;
            }
        }

        // HTTP/local-device fallback.
        if (!copied) {
            copied =
                copyTextFallback(
                    text
                );
        }

        if (copied) {
            toast(
                "Debug log copied"
            );

        } else {
            toast(
                "Unable to copy debug log"
            );
        }
    }
);

    renderDebugPanel();
}


function renderDebugPanel() {
    const output =
        document.getElementById(
            "scan-debug-output"
        );

    if (!output) {
        return;
    }

    output.textContent =
        debugLines.join("\n");

    output.scrollTop =
        output.scrollHeight;
}


function debugLog(message, details = null) {

    if (!debugEnabled) {
        return;
    }

    const now =
        new Date();

    const timestamp =
        now.toLocaleTimeString();

    let line =
        `[${timestamp}] ${message}`;

    if (details !== null) {
        try {
            line += " " +
                JSON.stringify(details);

        } catch {
            line += " " +
                String(details);
        }
    }

    debugLines.push(
        line
    );

    while (
        debugLines.length >
        MAX_DEBUG_LINES
    ) {
        debugLines.shift();
    }

    renderDebugPanel();

    console.log(
        "[Scan Debug]",
        message,
        details ?? ""
    );
}


/* ============================================================
   GENERIC HELPERS
   ============================================================ */
   
   
function copyTextFallback(text) {
    const textarea =
        document.createElement("textarea");

    textarea.value = text;

    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";

    document.body.appendChild(
        textarea
    );

    textarea.focus();
    textarea.select();

    let copied = false;

    try {
        copied =
            document.execCommand(
                "copy"
            );
    } catch {
        copied = false;
    }

    document.body.removeChild(
        textarea
    );

    return copied;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}


async function api(path, options = {}) {
    const response = await fetch(path, {
        cache: "no-store",
        ...options
    });

    let data;

    try {
        data = await response.json();
    } catch {
        throw new Error(
            `HTTP ${response.status}`
        );
    }

    if (!response.ok) {
        throw new Error(
            data.message || "Request failed"
        );
    }

    return data;
}


function toast(message) {
    const element =
        document.getElementById("toast");

    element.textContent = message;
    element.classList.add("visible");

    clearTimeout(
        window.toastTimer
    );

    window.toastTimer = setTimeout(
        () => {
            element.classList.remove(
                "visible"
            );
        },
        2500
    );
}


/* ============================================================
   BLE METADATA TABLES
   ============================================================ */

const KNOWN_SERVICES = {
    0x1800: "Generic Access",
    0x1801: "Generic Attribute",
    0x1802: "Immediate Alert",
    0x1803: "Link Loss",
    0x1804: "Tx Power",
    0x1805: "Current Time",
    0x1808: "Glucose",
    0x1809: "Health Thermometer",
    0x180A: "Device Information",
    0x180D: "Heart Rate",
    0x180E: "Phone Alert Status",
    0x180F: "Battery",
    0x1810: "Blood Pressure",
    0x1811: "Alert Notification",
    0x1812: "Human Interface Device",
    0x1813: "Scan Parameters",
    0x1814: "Running Speed and Cadence",
    0x1815: "Automation IO",
    0x1816: "Cycling Speed and Cadence",
    0x1818: "Cycling Power",
    0x1819: "Location and Navigation",
    0x181A: "Environmental Sensing",
    0x181B: "Body Composition",
    0x181C: "User Data",
    0x181D: "Weight Scale",
    0x181E: "Bond Management",
    0x181F: "Continuous Glucose Monitoring",
    0x1820: "Internet Protocol Support",
    0x1821: "Indoor Positioning",
    0x1822: "Pulse Oximeter",
    0x1823: "HTTP Proxy",
    0x1826: "Fitness Machine",
    0x1827: "Mesh Provisioning",
    0x1828: "Mesh Proxy",
    0x183B: "Binary Sensor",
    0x1840: "Generic Health Sensor",
    0x1848: "Media Control",
    0x1849: "Generic Media Control",
    0x1854: "Hearing Access",
    0x1857: "Electronic Shelf Label",
    0x1858: "Gaming Audio",

    // Bluetooth SIG member-assigned UUIDs commonly seen in advertisements.
    0xFE1F: "Garmin Service",
    0xFE21: "Bose Service",
    0xFE25: "Apple Service",
    0xFE26: "Google Service",
    0xFE27: "Google Service",
    0xFE2C: "Google Service",
    0xFE35: "Huawei Service",
    0xFE36: "Huawei Service"
};


// Generic device labels inferred from standard GATT services.
// These are deliberately broad; they do not claim a specific product model.
const SERVICE_DEVICE_HINTS = {
    0x1808: "Glucose Meter",
    0x1809: "Thermometer",
    0x180D: "Heart Rate Sensor",
    0x1810: "Blood Pressure Monitor",
    0x1812: "HID Device",
    0x1814: "Running Sensor",
    0x1816: "Cycling Sensor",
    0x1818: "Cycling Power Meter",
    0x1819: "Navigation Device",
    0x181A: "Environmental Sensor",
    0x181B: "Body Composition Device",
    0x181D: "Weight Scale",
    0x181F: "Glucose Monitor",
    0x1822: "Pulse Oximeter",
    0x1826: "Fitness Machine",
    0x183B: "Sensor",
    0x1840: "Health Sensor",
    0x1854: "Hearing Device",
    0x1858: "Gaming Audio Device"
};


const SERVICE_VENDOR_HINTS = {
    0xFE1F: "Garmin",
    0xFE21: "Bose",
    0xFE25: "Apple",
    0xFE26: "Google",
    0xFE27: "Google",
    0xFE2C: "Google",
    0xFE35: "Huawei",
    0xFE36: "Huawei"
};


const KNOWN_APPEARANCES = {
    0x0040: "Phone",
    0x0080: "Computer",
    0x0081: "Desktop Workstation",
    0x0082: "Server",
    0x0083: "Laptop",
    0x0087: "Tablet",
    0x0088: "Docking Station",
    0x008D: "IoT Gateway",
    0x008E: "Mini PC",
    0x00C0: "Watch",
    0x00C1: "Sports Watch",
    0x00C2: "Smartwatch",
    0x0100: "Clock",
    0x0140: "Display",
    0x0180: "Remote Control",
    0x01C0: "Smart Glasses",
    0x0200: "Tag",
    0x0240: "Keyring",
    0x0280: "Media Player",
    0x02C0: "Barcode Scanner",
    0x0300: "Thermometer",
    0x0340: "Heart Rate Sensor",
    0x0380: "Blood Pressure Monitor",
    0x03C0: "Generic HID",
    0x03C1: "Keyboard",
    0x03C2: "Mouse",
    0x03C3: "Joystick",
    0x03C4: "Gamepad",
    0x03C5: "Digitizer Tablet",
    0x03C6: "Card Reader",
    0x03C7: "Digital Pen",
    0x03C8: "Barcode Scanner",
    0x03C9: "Touchpad",
    0x03CA: "Presentation Remote",
    0x0400: "Glucose Meter",
    0x0440: "Running / Walking Sensor",
    0x0480: "Cycling Device",
    0x04C0: "Control Device",
    0x0500: "Network Device",
    0x0540: "Sensor",
    0x0580: "Light Fixture",
    0x05C0: "Fan",
    0x0600: "HVAC Device",
    0x0640: "Air Conditioner",
    0x0680: "Humidifier",
    0x06C0: "Heating Device",
    0x0700: "Access Control Device",
    0x0740: "Motorized Device"
};


// Appearance categories occupy 64-value ranges.  This lets us still
// produce a useful generic name when we have not listed the exact subtype.
const APPEARANCE_CATEGORY_RANGES = [
    [0x0040, 0x007F, "Phone"],
    [0x0080, 0x00BF, "Computer"],
    [0x00C0, 0x00FF, "Watch"],
    [0x0100, 0x013F, "Clock"],
    [0x0140, 0x017F, "Display"],
    [0x0180, 0x01BF, "Remote Control"],
    [0x01C0, 0x01FF, "Smart Glasses"],
    [0x0200, 0x023F, "Tag"],
    [0x0240, 0x027F, "Keyring"],
    [0x0280, 0x02BF, "Media Player"],
    [0x02C0, 0x02FF, "Barcode Scanner"],
    [0x0300, 0x033F, "Thermometer"],
    [0x0340, 0x037F, "Heart Rate Sensor"],
    [0x0380, 0x03BF, "Blood Pressure Monitor"],
    [0x03C0, 0x03FF, "HID Device"],
    [0x0400, 0x043F, "Glucose Meter"],
    [0x0440, 0x047F, "Running / Walking Sensor"],
    [0x0480, 0x04BF, "Cycling Device"],
    [0x04C0, 0x04FF, "Control Device"],
    [0x0500, 0x053F, "Network Device"],
    [0x0540, 0x057F, "Sensor"],
    [0x0580, 0x05BF, "Light Fixture"],
    [0x05C0, 0x05FF, "Fan"],
    [0x0600, 0x063F, "HVAC Device"],
    [0x0640, 0x067F, "Air Conditioner"],
    [0x0680, 0x06BF, "Humidifier"],
    [0x06C0, 0x06FF, "Heating Device"],
    [0x0700, 0x073F, "Access Control Device"],
    [0x0740, 0x077F, "Motorized Device"]
];


const KNOWN_COMPANIES = {
    0x0006: "Microsoft",
    0x004C: "Apple",
    0x0055: "Plantronics",
    0x0057: "Harman",
    0x0059: "Nordic Semiconductor",
    0x005C: "Belkin",
    0x005D: "Realtek",
    0x0065: "HP",
    0x0067: "GN Audio",
    0x0068: "General Motors",
    0x006B: "Polar",
    0x0075: "Samsung",
    0x0078: "Nike",
    0x0087: "Garmin",
    0x009E: "Bose",
    0x00D0: "Dexcom",
    0x00D7: "Qualcomm",
    0x00E0: "Google",
    0x012D: "Sony",
    0x018E: "Google / Fitbit",
    0x02F2: "GoPro"
};


const HID_SERVICE_UUID = 0x1812;


/* ============================================================
   BLE PAYLOAD PARSING
   ============================================================ */

function hexToBytes(hex) {
    if (!hex) {
        return [];
    }

    const clean =
        hex.replace(
            /[^0-9a-fA-F]/g,
            ""
        );

    const bytes = [];

    for (
        let i = 0;
        i + 1 < clean.length;
        i += 2
    ) {
        bytes.push(
            parseInt(
                clean.slice(
                    i,
                    i + 2
                ),
                16
            )
        );
    }

    return bytes;
}


function parseAdvertisementFields(hexPayload) {
    const bytes =
        hexToBytes(
            hexPayload
        );

    const fields = [];

    let i = 0;

    while (i < bytes.length) {
        const length = bytes[i];

        if (length === 0) {
            break;
        }

        const end =
            i + length + 1;

        if (
            end > bytes.length ||
            length < 1
        ) {
            break;
        }

        const type =
            bytes[i + 1];

        const data =
            bytes.slice(
                i + 2,
                end
            );

        fields.push({
            type,
            data
        });

        i = end;
    }

    return fields;
}


function decodeUtf8(bytes) {
    try {
        return new TextDecoder(
            "utf-8"
        ).decode(
            new Uint8Array(bytes)
        ).trim();

    } catch {
        return "";
    }
}


function parseLocalName(fields) {
    let shortName = "";

    for (const field of fields) {

        if (
            field.type !== 0x08 &&
            field.type !== 0x09
        ) {
            continue;
        }

        const value =
            decodeUtf8(
                field.data
            );

        if (!value) {
            continue;
        }

        if (field.type === 0x09) {
            return value;
        }

        if (!shortName) {
            shortName = value;
        }
    }

    return shortName;
}


function parse16BitServices(fields) {
    const services = [];

    function addService(uuid) {
        if (!services.includes(uuid)) {
            services.push(uuid);
        }
    }

    for (const field of fields) {

        // Incomplete / complete lists of 16-bit service UUIDs.
        if (
            field.type === 0x02 ||
            field.type === 0x03
        ) {
            for (
                let i = 0;
                i + 1 < field.data.length;
                i += 2
            ) {
                addService(
                    field.data[i] |
                    (field.data[i + 1] << 8)
                );
            }
        }

        // Service Data - 16-bit UUID.  A lot of consumer devices advertise
        // their useful UUID here without also publishing a service list.
        if (
            field.type === 0x16 &&
            field.data.length >= 2
        ) {
            addService(
                field.data[0] |
                (field.data[1] << 8)
            );
        }
    }

    return services;
}


function appearanceNameForValue(appearance) {
    if (appearance === null) {
        return null;
    }

    if (KNOWN_APPEARANCES[appearance]) {
        return KNOWN_APPEARANCES[appearance];
    }

    for (const [min, max, name] of APPEARANCE_CATEGORY_RANGES) {
        if (appearance >= min && appearance <= max) {
            return name;
        }
    }

    return null;
}


function serviceDeviceHint(services) {
    for (const service of services) {
        if (SERVICE_DEVICE_HINTS[service]) {
            return SERVICE_DEVICE_HINTS[service];
        }
    }

    return null;
}


function serviceVendorHint(services) {
    for (const service of services) {
        if (SERVICE_VENDOR_HINTS[service]) {
            return SERVICE_VENDOR_HINTS[service];
        }
    }

    return null;
}


function parseAppearance(fields) {
    for (const field of fields) {

        if (
            field.type === 0x19 &&
            field.data.length >= 2
        ) {
            return (
                field.data[0] |
                (
                    field.data[1]
                    << 8
                )
            );
        }
    }

    return null;
}


function parseCompanyId(fields) {
    for (const field of fields) {

        if (
            field.type === 0xFF &&
            field.data.length >= 2
        ) {
            return (
                field.data[0] |
                (
                    field.data[1]
                    << 8
                )
            );
        }
    }

    return null;
}



/* ============================================================
   CONTROLLER IDENTIFICATION
   ============================================================ */

// These patterns are intentionally conservative. They only operate on a
// device-provided advertised name; we do not invent exact models from a
// manufacturer ID alone.
const CONTROLLER_NAME_PATTERNS = [
    /\bxbox\b/i,
    /\belite\b.*\bcontroller\b/i,
    /\bwireless controller\b/i,
    /\bdualsense\b/i,
    /\bdualshock\b/i,
    /\b8bitdo\b/i,
    /\bgamesir\b/i,
    /\bgamepad\b/i,
    /\bjoy[\s-]?con\b/i,
    /\bpro controller\b/i,
    /\bstadia controller\b/i,
    /\bluna controller\b/i,
    /\bbackbone\b/i,
    /\bkishi\b/i
];


function controllerNameMatch(name) {
    if (!name) {
        return false;
    }

    return CONTROLLER_NAME_PATTERNS.some(
        pattern => pattern.test(name)
    );
}


function controllerConfidence({
    actualName,
    gamepad,
    joystick,
    hid
}) {
    let score = 0;
    const reasons = [];

    if (gamepad) {
        score += 100;
        reasons.push("Gamepad appearance");
    }

    if (joystick) {
        score += 100;
        reasons.push("Joystick appearance");
    }

    if (controllerNameMatch(actualName)) {
        score += 90;
        reasons.push("Controller name");
    }

    if (hid) {
        score += 20;
        reasons.push("BLE HID");
    }

    return {
        score,
        reasons,
        likely:
            score >= 90
    };
}


function analyzeBleDevice(device) {
    const payloads =
        Array.isArray(device.payloads) &&
        device.payloads.length
            ? device.payloads
            : [device.payload || ""];

    let payloadName = "";
    const services = [];
    let appearance = null;
    let companyId = null;

    for (const payload of payloads) {
        const fields =
            parseAdvertisementFields(
                payload
            );

        const foundName =
            parseLocalName(
                fields
            );

        if (
            foundName &&
            !payloadName
        ) {
            payloadName =
                foundName;
        }

        const foundServices =
            parse16BitServices(
                fields
            );

        for (
            const service
            of foundServices
        ) {
            if (
                !services.includes(
                    service
                )
            ) {
                services.push(
                    service
                );
            }
        }

        const foundAppearance =
            parseAppearance(
                fields
            );

        if (
            foundAppearance !== null
        ) {
            appearance =
                foundAppearance;
        }

        const foundCompanyId =
            parseCompanyId(
                fields
            );

        if (
            foundCompanyId !== null
        ) {
            companyId =
                foundCompanyId;
        }
    }

    const manufacturer =
        companyId !== null
            ? KNOWN_COMPANIES[
                companyId
              ] || null
            : null;

    const appearanceName =
        appearanceNameForValue(
            appearance
        );

    const hid =
        services.includes(
            HID_SERVICE_UUID
        );

    const gamepad =
        appearance === 0x03C4;

    const joystick =
        appearance === 0x03C3;

    const actualName =
        device.name ||
        payloadName ||
        "";

    const controllerMatch =
        controllerConfidence({
            actualName,
            gamepad,
            joystick,
            hid
        });

    const likelyController =
        controllerMatch.likely;

    const deviceTypeHint =
        serviceDeviceHint(
            services
        );

    const serviceVendor =
        serviceVendorHint(
            services
        );

    return {
        mac: device.mac,
        rssi: device.rssi,
        payload:
            device.payload || "",
        payloads,
        actualName,
        services,
        appearance,
        appearanceName,
        companyId,
        manufacturer,
        deviceTypeHint,
        serviceVendor,
        hid,
        gamepad,
        joystick,
        likelyController,
        controllerScore:
            controllerMatch.score,
        controllerReasons:
            controllerMatch.reasons
    };
}


/* ============================================================
   BROWSER-SIDE DEVICE CACHE
   ============================================================ */

function mergeDeviceIntoCache(observation) {
    let cached =
        deviceCache.get(
            observation.mac
        );

    if (!cached) {
        cached = {
            mac: observation.mac,
            actualName: "",
            services: [],
            appearance: null,
            appearanceName: null,
            companyId: null,
            manufacturer: null,
            deviceTypeHint: null,
            serviceVendor: null,
            hid: false,
            gamepad: false,
            joystick: false,
            likelyController: false,
            controllerScore: 0,
            controllerReasons: [],
            payloads: [],
            rssi: observation.rssi,
            lastSeen:
                Date.now()
        };

        deviceCache.set(
            observation.mac,
            cached
        );
    }

    if (observation.actualName) {
        cached.actualName =
            observation.actualName;
    }

    for (
        const service
        of observation.services
    ) {
        if (
            !cached.services.includes(
                service
            )
        ) {
            cached.services.push(
                service
            );
        }
    }

    if (
        observation.appearance !== null
    ) {
        cached.appearance =
            observation.appearance;

        cached.appearanceName =
            observation.appearanceName;
    }

    if (
        observation.companyId !== null
    ) {
        cached.companyId =
            observation.companyId;
    }

    if (observation.manufacturer) {
        cached.manufacturer =
            observation.manufacturer;
    }

    if (observation.deviceTypeHint) {
        cached.deviceTypeHint =
            observation.deviceTypeHint;
    }

    if (observation.serviceVendor) {
        cached.serviceVendor =
            observation.serviceVendor;
    }

    cached.hid =
        cached.hid ||
        observation.hid;

    cached.gamepad =
        cached.gamepad ||
        observation.gamepad;

    cached.joystick =
        cached.joystick ||
        observation.joystick;

    cached.likelyController =
        cached.likelyController ||
        observation.likelyController;

    cached.controllerScore =
        Math.max(
            cached.controllerScore || 0,
            observation.controllerScore || 0
        );

    for (
        const reason
        of observation.controllerReasons || []
    ) {
        if (
            !cached.controllerReasons.includes(
                reason
            )
        ) {
            cached.controllerReasons.push(
                reason
            );
        }
    }

    for (
        const payload
        of observation.payloads
    ) {
        if (
            payload &&
            !cached.payloads.includes(
                payload
            )
        ) {
            cached.payloads.push(
                payload
            );

            while (
                cached.payloads.length >
                MAX_PAYLOADS_PER_DEVICE
            ) {
                cached.payloads.shift();
            }
        }
    }

    cached.rssi =
        observation.rssi;

    cached.lastSeen =
        Date.now();

    rebuildCachedDisplayName(
        cached
    );

    trimDeviceCache();

    return cached;
}


function rebuildCachedDisplayName(device) {
    // Best source: the device actually advertised its own name.
    if (device.actualName) {
        device.displayName =
            device.actualName;

        device.nameSource =
            "advertised";

        return;
    }

    // Strong controller-specific inference.
    if (device.gamepad) {
        device.displayName =
            `${device.manufacturer || device.serviceVendor || "BLE"} Gamepad`;

        device.nameSource =
            "inferred";

        return;
    }

    if (device.joystick) {
        device.displayName =
            `${device.manufacturer || device.serviceVendor || "BLE"} Joystick`;

        device.nameSource =
            "inferred";

        return;
    }

    // Standard Bluetooth Appearance is stronger than a generic service hint.
    if (
        device.appearanceName &&
        device.appearanceName !== "Generic HID"
    ) {
        const vendor =
            device.manufacturer ||
            device.serviceVendor;

        device.displayName = vendor
            ? `${vendor} ${device.appearanceName}`
            : device.appearanceName;

        device.nameSource =
            "inferred";

        return;
    }

    // A standard GATT service can often tell us what class of device it is.
    if (device.deviceTypeHint) {
        const vendor =
            device.manufacturer ||
            device.serviceVendor;

        device.displayName = vendor
            ? `${vendor} ${device.deviceTypeHint}`
            : device.deviceTypeHint;

        device.nameSource =
            "inferred";

        return;
    }

    if (device.hid) {
        device.displayName =
            `${device.manufacturer || device.serviceVendor || "BLE"} HID Device`;

        device.nameSource =
            "inferred";

        return;
    }

    // Manufacturer-specific data alone is still more useful than "Unnamed".
    if (device.manufacturer) {
        device.displayName =
            `${device.manufacturer} Bluetooth Device`;

        device.nameSource =
            "inferred";

        return;
    }

    // Some advertisements identify a vendor through a member-assigned
    // service UUID even when there is no manufacturer-data field.
    if (device.serviceVendor) {
        device.displayName =
            `${device.serviceVendor} Bluetooth Device`;

        device.nameSource =
            "inferred";

        return;
    }

    device.displayName =
        "Unnamed device";

    device.nameSource =
        "unknown";
}


function trimDeviceCache() {
    if (
        deviceCache.size <=
        MAX_CACHED_DEVICES
    ) {
        return;
    }

    const entries =
        Array.from(
            deviceCache.entries()
        );

    entries.sort(
        (a, b) =>
            a[1].lastSeen -
            b[1].lastSeen
    );

    while (
        entries.length >
        MAX_CACHED_DEVICES
    ) {
        const oldest =
            entries.shift();

        deviceCache.delete(
            oldest[0]
        );
    }
}


/* ============================================================
   SYSTEM STATUS
   ============================================================ */

async function refreshStatus() {
    try {
        const status =
            await api(
                "/api/status"
            );
            
        debugEnabled =
            status.web_ui_debug === true;

        if (debugEnabled) {
            ensureDebugPanel();
        }

        const system =
            document.getElementById(
                "system-state"
            );

        system.textContent =
            status.system;

        system.className =
            status.system === "RUNNING"
                ? "good"
                : "bad";

        document.getElementById(
            "psu-state"
        ).textContent =
            status.psu;

        document.getElementById(
            "ip-address"
        ).textContent =
            status.ip ||
            "Not connected";

    } catch (error) {
        console.log(error);
    }
}


/* ============================================================
   CONTROLLER LIST
   ============================================================ */

async function refreshControllers() {
    const data =
        await api(
            "/api/controllers"
        );

    controllers =
        data.controllers;

    maxControllers =
        data.max;

    document.getElementById(
        "controller-count"
    ).textContent =
        `${controllers.length} / ${maxControllers} configured`;

    const container =
        document.getElementById(
            "controllers"
        );

    if (!controllers.length) {
        container.innerHTML = `
            <p class="muted">
                No wake controllers configured.
            </p>
        `;

        return;
    }

    container.innerHTML =
        controllers.map(
            controller => `
                <div class="controller">

                    <div class="controller-title">
                        ${escapeHtml(controller.name)}
                    </div>

                    <div class="mac">
                        ${escapeHtml(controller.mac)}
                    </div>

                    <div class="actions">

                        <button
                            class="secondary"
                            onclick='editController(
                                ${JSON.stringify(controller.mac)}
                            )'
                        >
                            Edit
                        </button>

                        <button
                            class="danger"
                            onclick='removeController(
                                ${JSON.stringify(controller.mac)}
                            )'
                        >
                            Remove
                        </button>

                    </div>

                </div>
            `
        ).join("");
}


/* ============================================================
   CONTROLLER ADD / EDIT / REMOVE
   ============================================================ */

async function addManualController() {
    const name =
        document.getElementById(
            "new-name"
        ).value.trim();

    const mac =
        document.getElementById(
            "new-mac"
        ).value.trim();

    await addController(
        name,
        mac
    );
}


async function addController(name, mac) {
    try {
        const result =
            await api(
                "/api/controllers/add",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        name,
                        mac
                    })
                }
            );

        toast(
            result.message
        );

        document.getElementById(
            "new-name"
        ).value = "";

        document.getElementById(
            "new-mac"
        ).value = "";

        await refreshControllers();

    } catch (error) {
        toast(
            error.message
        );
    }
}


async function removeController(mac) {
    const controller =
        controllers.find(
            item =>
                item.mac === mac
        );

    const label =
        controller
            ? controller.name
            : mac;

    if (
        !confirm(
            `Remove ${label}?`
        )
    ) {
        return;
    }

    try {
        const result =
            await api(
                "/api/controllers/remove",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        mac
                    })
                }
            );

        toast(
            result.message
        );

        await refreshControllers();

    } catch (error) {
        toast(
            error.message
        );
    }
}


async function editController(oldMac) {
    const controller =
        controllers.find(
            item =>
                item.mac === oldMac
        );

    if (!controller) {
        return;
    }

    const name =
        prompt(
            "Controller name:",
            controller.name
        );

    if (name === null) {
        return;
    }

    const mac =
        prompt(
            "MAC address:",
            controller.mac
        );

    if (mac === null) {
        return;
    }

    try {
        const result =
            await api(
                "/api/controllers/update",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        old_mac: oldMac,
                        name,
                        mac
                    })
                }
            );

        toast(
            result.message
        );

        await refreshControllers();

    } catch (error) {
        toast(
            error.message
        );
    }
}


/* ============================================================
   BLE SCANNING
   ============================================================ */

async function startScan() {

    if (debugEnabled) {
        ensureDebugPanel();
    }

    debugLog(
        "Starting scan flow"
    );

    const button =
        document.getElementById(
            "scan-button"
        );

    const status =
        document.getElementById(
            "scan-status"
        );

    button.disabled = true;

    status.className =
        "scan-status";

    status.textContent =
        "Scanning for 5 seconds...";

    document.getElementById(
        "scan-results"
    ).innerHTML = `
        <p class="muted">
            Listening for BLE advertisements...
        </p>
    `;

    try {
        debugLog(
            "POST /api/scan"
        );

        const result =
            await api(
                "/api/scan",
                {
                    method: "POST"
                }
            );

        debugLog(
            "POST /api/scan succeeded",
            result
        );

        debugLog(
            "Beginning scan polling"
        );

        pollScanResults();

    } catch (error) {
        debugLog(
            "POST /api/scan failed",
            {
                message:
                    error.message
            }
        );

        button.disabled = false;
        status.textContent = "";

        toast(
            error.message
        );
    }
}


async function pollScanResults() {
    debugLog(
        "GET /api/scan"
    );

    try {
        const data =
            await api(
                "/api/scan"
            );

        debugLog(
            "GET /api/scan succeeded",
            {
                scanning:
                    data.scanning,
                done:
                    data.done,
                devices:
                    Array.isArray(data.devices)
                        ? data.devices.length
                        : null
            }
        );

        if (data.scanning) {
            debugLog(
                "ESP still scanning; polling again in 750 ms"
            );

            setTimeout(
                pollScanResults,
                750
            );

            return;
        }

        debugLog(
            "Scan complete; beginning device analysis",
            {
                devices:
                    Array.isArray(data.devices)
                        ? data.devices.length
                        : null
            }
        );

        const observations =
            data.devices.map(
                analyzeBleDevice
            );

        debugLog(
            "Device analysis complete",
            {
                observations:
                    observations.length
            }
        );

        const currentMacs =
            new Set(
                observations.map(
                    device =>
                        device.mac
                )
            );

        const comparisonAvailable =
            previousScanMacs !== null;

        debugLog(
            "Merging scan into browser cache",
            {
                cacheBefore:
                    deviceCache.size,
                comparisonAvailable
            }
        );

        const displayedDevices = [];

        for (
            const observation
            of observations
        ) {
            const cached =
                mergeDeviceIntoCache(
                    observation
                );

            const displayDevice = {
                ...cached,

                services: [
                    ...cached.services
                ],

                payloads: [
                    ...cached.payloads
                ],

                isNew:
                    comparisonAvailable &&
                    !previousScanMacs.has(
                        observation.mac
                    )
            };

            displayedDevices.push(
                displayDevice
            );
        }

        debugLog(
            "Browser cache merge complete",
            {
                cacheAfter:
                    deviceCache.size,
                displayed:
                    displayedDevices.length
            }
        );

        previousScanMacs =
            currentMacs;

        debugLog(
            "Rendering scan results"
        );

        renderScanResults(
            displayedDevices,
            comparisonAvailable
        );

        debugLog(
            "Render complete"
        );

        document.getElementById(
            "scan-button"
        ).disabled = false;

        const status =
            document.getElementById(
                "scan-status"
            );

        if (comparisonAvailable) {
            const newCount =
                displayedDevices.filter(
                    device =>
                        device.isNew
                ).length;

            status.textContent =
                `${displayedDevices.length} device(s) found · ` +
                `${newCount} new since previous scan`;

            debugLog(
                "Scan flow complete",
                {
                    devices:
                        displayedDevices.length,
                    newDevices:
                        newCount
                }
            );

        } else {
            status.textContent =
                `${displayedDevices.length} device(s) found · ` +
                `baseline saved for next scan`;

            debugLog(
                "Scan flow complete; baseline saved",
                {
                    devices:
                        displayedDevices.length
                }
            );
        }

    } catch (error) {
        debugLog(
            "Scan polling/processing failed",
            {
                name:
                    error.name || null,
                message:
                    error.message || String(error),
                stack:
                    error.stack || null
            }
        );

        document.getElementById(
            "scan-button"
        ).disabled = false;

        toast(
            error.message
        );
    }
}


/* ============================================================
   BLE RESULT RENDERING
   ============================================================ */

function metadataChips(device) {
    const chips = [];

    if (device.likelyController) {
        chips.push(`
            <span class="chip controller-chip">
                Likely controller
            </span>
        `);
    }

    if (device.manufacturer) {
        chips.push(`
            <span class="chip">
                ${escapeHtml(device.manufacturer)}
            </span>
        `);
    }

    if (device.appearanceName) {
        chips.push(`
            <span class="chip">
                ${escapeHtml(device.appearanceName)}
            </span>
        `);
    }

    if (device.hid) {
        chips.push(`
            <span class="chip">
                BLE HID
            </span>
        `);
    }

    return chips.join("");
}


function serviceDescription(device) {
    if (
        !device.services ||
        !device.services.length
    ) {
        return "";
    }

    const labels =
        device.services.map(uuid => {
            const label =
                KNOWN_SERVICES[uuid];

            if (label) {
                return (
                    `${label} ` +
                    `(0x${uuid
                        .toString(16)
                        .toUpperCase()
                        .padStart(4, "0")})`
                );
            }

            return (
                `0x${uuid
                    .toString(16)
                    .toUpperCase()
                    .padStart(4, "0")}`
            );
        });

    return `
        <div class="service-list">
            ${labels
                .map(escapeHtml)
                .join(" · ")}
        </div>
    `;
}



function controllerSort(a, b) {
    if (
        a.likelyController !==
        b.likelyController
    ) {
        return a.likelyController
            ? -1
            : 1;
    }

    if (
        (a.controllerScore || 0) !==
        (b.controllerScore || 0)
    ) {
        return (
            (b.controllerScore || 0) -
            (a.controllerScore || 0)
        );
    }

    if (a.isNew !== b.isNew) {
        return a.isNew
            ? -1
            : 1;
    }

    return b.rssi - a.rssi;
}


function signalSort(a, b) {
    if (a.isNew !== b.isNew) {
        return a.isNew
            ? -1
            : 1;
    }

    return b.rssi - a.rssi;
}


function scanViewControls(devices) {
    const controllerCount =
        devices.filter(
            device =>
                device.likelyController
        ).length;

    const controllerClass =
        scanViewMode === "controllers-first"
            ? "primary"
            : "secondary";

    const signalClass =
        scanViewMode === "signal"
            ? "primary"
            : "secondary";

    return `
        <div style="
            display:flex;
            align-items:center;
            justify-content:space-between;
            flex-wrap:wrap;
            gap:8px;
            margin:4px 0 14px 0;
        ">
            <div class="muted" style="font-size:0.82rem;">
                ${controllerCount} likely controller${controllerCount === 1 ? "" : "s"}
            </div>

            <div style="
                display:flex;
                align-items:center;
                gap:6px;
                flex-wrap:wrap;
            ">
                <span class="muted" style="font-size:0.78rem;">
                    Sort:
                </span>

                <button
                    type="button"
                    class="${controllerClass}"
                    onclick='setScanViewMode("controllers-first")'
                    style="
                        padding:5px 9px;
                        font-size:0.76rem;
                    "
                >
                    Controllers first
                </button>

                <button
                    type="button"
                    class="${signalClass}"
                    onclick='setScanViewMode("signal")'
                    style="
                        padding:5px 9px;
                        font-size:0.76rem;
                    "
                >
                    Signal
                </button>
            </div>
        </div>
    `;
}


function setScanViewMode(mode) {
    scanViewMode =
        mode === "signal"
            ? "signal"
            : "controllers-first";

    renderScanResults(
        lastRenderedDevices,
        lastComparisonAvailable
    );
}


function renderScanResults(
    devices,
    comparisonAvailable
) {
    const container =
        document.getElementById(
            "scan-results"
        );

    if (!devices.length) {
        container.innerHTML = `
            <p class="muted">
                No BLE devices detected.
            </p>
        `;

        return;
    }

    lastRenderedDevices =
        devices;

    lastComparisonAvailable =
        comparisonAvailable;

    const sortedDevices =
        [...devices];

    sortedDevices.sort(
        scanViewMode === "signal"
            ? signalSort
            : controllerSort
    );

    const controls =
        scanViewControls(
            sortedDevices
        );

    container.innerHTML =
        controls +
        sortedDevices.map(device => {

            const alreadySaved =
                controllers.some(
                    item =>
                        item.mac ===
                        device.mac
                );

            const suggestedName =
                device.actualName ||
                device.displayName ||
                "Bluetooth Device";

            const newBadge =
                comparisonAvailable &&
                device.isNew
                    ? `
                        <span class="new-badge">
                            NEW
                        </span>
                      `
                    : "";

            let companyLine = "";

            if (
                device.companyId !== null
            ) {
                companyLine = `
                    <div class="metadata-line">
                        Company ID:
                        0x${device.companyId
                            .toString(16)
                            .toUpperCase()
                            .padStart(4, "0")}
                        ${
                            device.manufacturer
                                ? ` · ${escapeHtml(
                                    device.manufacturer
                                )}`
                                : ""
                        }
                    </div>
                `;
            }

            let appearanceLine = "";

            if (
                device.appearance !== null
            ) {
                appearanceLine = `
                    <div class="metadata-line">
                        Appearance:
                        0x${device.appearance
                            .toString(16)
                            .toUpperCase()
                            .padStart(4, "0")}
                        ${
                            device.appearanceName
                                ? ` · ${escapeHtml(
                                    device.appearanceName
                                )}`
                                : ""
                        }
                    </div>
                `;
            }

            let controllerLine = "";

            if (
                device.likelyController &&
                device.controllerReasons &&
                device.controllerReasons.length
            ) {
                controllerLine = `
                    <div class="metadata-line">
                        Controller match:
                        ${device.controllerReasons
                            .map(escapeHtml)
                            .join(" · ")}
                    </div>
                `;
            }


            let learnedLine = "";

            if (
                device.payloads &&
                device.payloads.length > 1
            ) {
                learnedLine = `
                    <div class="metadata-line">
                        Learned from
                        ${device.payloads.length}
                        advertisement variants
                    </div>
                `;
            }

            return `
                <div
                    class="device
                    ${device.isNew ? "device-new" : ""}"
                >

                    <div class="device-heading">

                        <div class="device-title">
                            ${escapeHtml(
                                device.displayName
                            )}
                        </div>

                        ${newBadge}

                    </div>

                    <div class="mac">
                        ${escapeHtml(
                            device.mac
                        )}
                    </div>

                    <div class="rssi">
                        RSSI:
                        ${device.rssi} dBm
                    </div>

                    <div class="chips">
                        ${metadataChips(device)}
                    </div>

                    ${appearanceLine}

                    ${companyLine}

                    ${serviceDescription(device)}

                    ${controllerLine}

                    ${learnedLine}

                    <div class="actions">

                        ${
                            alreadySaved
                                ? `
                                    <button
                                        class="secondary"
                                        disabled
                                    >
                                        Already Added
                                    </button>
                                  `
                                : `
                                    <button
                                        class="primary"
                                        onclick='addScannedDevice(
                                            ${JSON.stringify(suggestedName)},
                                            ${JSON.stringify(device.mac)}
                                        )'
                                    >
                                        Add
                                    </button>
                                  `
                        }

                    </div>

                </div>
            `;
        }).join("");
}


/* ============================================================
   ADD FROM SCAN
   ============================================================ */

async function addScannedDevice(
    suggestedName,
    mac
) {
    const name =
        prompt(
            "Controller name:",
            suggestedName
        );

    if (name === null) {
        return;
    }

    await addController(
        name,
        mac
    );
}


/* ============================================================
   INITIALIZATION
   ============================================================ */

async function initialLoad() {

    debugLog(
        "Web app loaded"
    );

    try {
        await Promise.all([
            refreshStatus(),
            refreshControllers()
        ]);

        debugLog(
            "Initial status/controller load complete"
        );

    } catch (error) {
        debugLog(
            "Initial load failed",
            {
                message:
                    error.message
            }
        );

        toast(
            "Failed loading controller data"
        );
    }
}


initialLoad();


setInterval(
    refreshStatus,
    5000
);

