# GPIO: BC-250 Wake board, XIAO ESP32-C3 socketed
# (upstream hand-wired defaults were BC250_BUTTON=2 and no LED)
PIN_BC250_BUTTON = 7   # D5 -> Q3 -> BC-250 power-button pad. GPIO2 is a strapping pin and
                       #       GPIO6 carries a boot-time pull-up, so neither may drive this.
PIN_BC250_SENSE = 3    # D1 <- HOST_ON: BC-250 CPU_FAN1 12 V through 30k/10k
PIN_CASE_BUTTON = 4    # D2 <- front-panel switch (10k pull-up and 100 nF on the board)
PIN_PS_ON = 5          # D3 -> Q1 -> PSU PS_ON. Q2 holds PS_ON in hardware while HOST_ON is high.
PIN_LED = 6            # D4 -> Q4 -> LED ring on J6 and onboard D1, active high, PWM

# Power timing
DEBOUNCE_MS = 50
BC250_PRESS_MS = 250
FORCE_OFF_HOLD_MS = 4000
FORCE_OFF_PRESS_MS = 5500   # BC-250 hard-off needs its power button held longer than 4 s
STARTUP_GRACE_MS = 10000

# BLE wake
WAKE_RSSI_MIN = -85
WAKE_HITS_REQUIRED = 2
WAKE_HIT_WINDOW_MS = 1500
WAKE_SCAN_MS = 3000
WEB_SCAN_MS = 5000

# Controller storage
CONTROLLERS_FILE = "controllers.json"
MAX_CONTROLLERS = 4

# Web scanning
MAX_WEB_PAYLOADS_PER_DEVICE = 4

# Wi-Fi
WIFI_CONNECT_TIMEOUT_MS = 15000
HOSTNAME = "bc250-controller"

# WEB UI
WEB_UI_DEBUG = False

# Initial controllers on a fresh installation
DEFAULT_CONTROLLERS = []
