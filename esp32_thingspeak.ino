#include <WiFi.h>
#include <ThingSpeak.h>

const char* ssid = "Edge 40";
const char* password = "123456789";

unsigned long channelID = 3254832;
const char* writeAPIKey = "S1PJEALHD9RQGVU6";

WiFiClient client;

#define FLAME_SENSOR_PIN 34
#define TEMPERATURE_SENSOR_PIN 35
#define SMOKE_SENSOR_PIN 32

const float ADC_REFERENCE_VOLTAGE = 3.3f;
const int ADC_MAX_VALUE = 4095;

void connectToWiFi() {
  WiFi.begin(ssid, password);

  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("Connected to WiFi");
}

float readTemperatureC() {
  int raw = analogRead(TEMPERATURE_SENSOR_PIN);
  float voltage = (raw * ADC_REFERENCE_VOLTAGE) / ADC_MAX_VALUE;

  // LM35 style conversion: 10 mV per degree C.
  return voltage * 100.0f;
}

int readSmokeLevel() {
  return analogRead(SMOKE_SENSOR_PIN);
}

int readFireStatus() {
  return digitalRead(FLAME_SENSOR_PIN) == LOW ? 1 : 0;
}

void setup() {
  Serial.begin(115200);

  pinMode(FLAME_SENSOR_PIN, INPUT);
  pinMode(TEMPERATURE_SENSOR_PIN, INPUT);
  pinMode(SMOKE_SENSOR_PIN, INPUT);

  analogReadResolution(12);

  connectToWiFi();
  ThingSpeak.begin(client);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
  }

  int fireStatus = readFireStatus();
  float temperatureC = readTemperatureC();
  int smokeLevel = readSmokeLevel();

  Serial.print("Fire: ");
  Serial.print(fireStatus);
  Serial.print(" | Temperature: ");
  Serial.print(temperatureC, 1);
  Serial.print(" C | Smoke: ");
  Serial.println(smokeLevel);

  ThingSpeak.setField(1, fireStatus);
  ThingSpeak.setField(2, temperatureC);
  ThingSpeak.setField(3, smokeLevel);

  int responseCode = ThingSpeak.writeFields(channelID, writeAPIKey);

  if (responseCode == 200) {
    Serial.println("ThingSpeak update successful.");
  } else {
    Serial.print("ThingSpeak update failed. HTTP error code: ");
    Serial.println(responseCode);
  }

  delay(15000);
}
