# buildroot/external.mk
# Required when using BR2_EXTERNAL to point Buildroot at our board files.
include $(sort $(wildcard $(BR2_EXTERNAL_SAN_PATH)/package/*/*.mk))
