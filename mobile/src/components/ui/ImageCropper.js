import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Image, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    runOnJS,
    withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ImageCropper({ uri, onSave, onCancel, colors, forcedInsets = null }) {
    const insets = useSafeAreaInsets();
    const effectiveInsets = forcedInsets || insets || { top: 0, bottom: 0, left: 0, right: 0 };
    const { width: screenWidth, height: screenHeight } = useWindowDimensions();
    const [mode, setMode] = useState('crop'); // 'crop' | 'thumbnail'
    const [aspectRatio, setAspectRatio] = useState(0); // 0 = free/original, 1 = 1:1, 0.75 = 3:4, 1.33 = 4:3
    const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
    const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
    const [loading, setLoading] = useState(true);

    // Gestures
    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const savedTranslateX = useSharedValue(0);
    const savedTranslateY = useSharedValue(0);
    const rotation = useSharedValue(0); // in degrees
    const savedRotation = useSharedValue(0);

    // Thumbnail specific (relative to the screen's view of the main crop)
    const thumbScale = useSharedValue(1);
    const thumbSavedScale = useSharedValue(1);
    const thumbTranslateX = useSharedValue(0);
    const thumbTranslateY = useSharedValue(0);
    const thumbSavedTranslateX = useSharedValue(0);
    const thumbSavedTranslateY = useSharedValue(0);

    const debugCropper = (stage, payload) => {
        if (!__DEV__) return;
        try {
            console.log(`[OwnerPhotoCropDebug] [ImageCropper] ${stage}`, JSON.stringify(payload));
        } catch {
            console.log(`[OwnerPhotoCropDebug] [ImageCropper] ${stage}`, payload);
        }
    };

    useEffect(() => {
        Image.getSize(uri, (width, height) => {
            setImageSize({ width, height });
            setLoading(false);
        }, () => {
            setLoading(false);
        });
    }, [uri]);

    // Pan Gesture
    const panGesture = Gesture.Pan()
        .onUpdate((e) => {
            if (mode === 'crop') {
                translateX.value = savedTranslateX.value + e.translationX;
                translateY.value = savedTranslateY.value + e.translationY;
            } else {
                thumbTranslateX.value = thumbSavedTranslateX.value + e.translationX;
                thumbTranslateY.value = thumbSavedTranslateY.value + e.translationY;
            }
        })
        .onEnd(() => {
            if (mode === 'crop') {
                savedTranslateX.value = translateX.value;
                savedTranslateY.value = translateY.value;
            } else {
                thumbSavedTranslateX.value = thumbTranslateX.value;
                thumbSavedTranslateY.value = thumbTranslateY.value;
            }
        });

    // Pinch Gesture
    const pinchGesture = Gesture.Pinch()
        .onUpdate((e) => {
            if (mode === 'crop') {
                scale.value = savedScale.value * e.scale;
            } else {
                thumbScale.value = thumbSavedScale.value * e.scale;
            }
        })
        .onEnd(() => {
            if (mode === 'crop') {
                savedScale.value = scale.value;
            } else {
                thumbSavedScale.value = thumbScale.value;
            }
        });

    // Rotation Slider Gesture (Pan on slider)
    const rotationPanGesture = Gesture.Pan()
        .onUpdate((e) => {
            if (mode === 'crop') {
                // simple mapping: 1px = 0.5 degrees
                const newRot = savedRotation.value + (e.translationX * 0.5);
                rotation.value = Math.max(-45, Math.min(45, newRot));
            }
        })
        .onEnd(() => {
            if (mode === 'crop') {
                savedRotation.value = rotation.value;
            }
        });

    const composedImageGesture = Gesture.Simultaneous(panGesture, pinchGesture);

    // Determine the crop window size on screen
    const workingWidth = viewportSize.width || screenWidth;
    const workingHeight = viewportSize.height || screenHeight;
    const windowWidth = Math.max(120, workingWidth - 40);
    let windowHeight = windowWidth;
    if (aspectRatio === 0.75) windowHeight = windowWidth * (4/3);
    if (aspectRatio === 1.33) windowHeight = windowWidth * (3/4);
    
    // Initial scale to fit the image
    const initialImgScale = Math.min(
        windowWidth / Math.max(1, imageSize.width),
        windowHeight / Math.max(1, imageSize.height),
    );

    const animatedImageStyle = useAnimatedStyle(() => {
        return {
            transform: [
                // Keep pan as unscaled screen-space translation; save math
                // maps translate back with `/ finalScale`.
                { translateX: translateX.value },
                { translateY: translateY.value },
                // Keep render-time base fit scale and user zoom in one factor.
                { scale: initialImgScale * scale.value },
                { rotate: `${rotation.value}deg` },
            ],
        };
    }, [initialImgScale]);

    const animatedThumbMaskStyle = useAnimatedStyle(() => {
        return {
            transform: [
                { scale: thumbScale.value },
                { translateX: thumbTranslateX.value },
                { translateY: thumbTranslateY.value },
            ],
        };
    });

    const handleSave = () => {
        // Calculate crop bounds relative to the original image.
        // For simplicity, we center the image initially.
        // View width/height are derived from current window dimensions.
        
        let targetCropRatio = aspectRatio || (imageSize.width / imageSize.height);
        
        // Return structured data for the parent to process using ImageManipulator
        // and the backend `box` format.
        const payload = {
            mainCrop: {
                scale: scale.value,
                translateX: translateX.value,
                translateY: translateY.value,
                rotation: rotation.value,
                aspectRatio: targetCropRatio,
            },
            thumbnailBox: {
                // Center offset and scale for the 3:4 thumbnail
                scale: thumbScale.value,
                translateX: thumbTranslateX.value,
                translateY: thumbTranslateY.value,
                aspectRatio: 3/4
            },
            viewSize: {
                width: windowWidth,
                height: windowHeight,
            },
            imageSize,
            displayBaseScale: initialImgScale,
        };

        debugCropper('handleSave.payload', {
            mode,
            aspectRatio,
            workingSize: { width: workingWidth, height: workingHeight },
            windowSize: payload.viewSize,
            imageSize: payload.imageSize,
            mainCrop: payload.mainCrop,
            thumbnailBox: payload.thumbnailBox,
        });

        onSave(payload);
    };

    if (loading) {
        return (
            <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center' }]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    return (
        <GestureHandlerRootView style={[styles.container, { backgroundColor: '#000' }]}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: Math.max(effectiveInsets.top, 16) }]}>
                <TouchableOpacity onPress={onCancel} style={styles.headerBtn}>
                    <Ionicons name="close" size={24} color="#FFF" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Edit Photo</Text>
                <TouchableOpacity onPress={handleSave} style={styles.headerBtn}>
                    <Text style={styles.saveText}>Save</Text>
                </TouchableOpacity>
            </View>

            {/* Interactive Image Area */}
            <View
                style={styles.imageContainer}
                onLayout={(event) => {
                    const { width, height } = event.nativeEvent.layout || {};
                    if (!width || !height) return;
                    setViewportSize((prev) => {
                        if (prev.width === width && prev.height === height) return prev;
                        return { width, height };
                    });
                }}
            >
                <GestureDetector gesture={composedImageGesture}>
                    <Animated.View style={styles.gestureView}>
                        <Animated.Image 
                            source={{ uri }} 
            style={[
                                {
                                    width: imageSize.width,
                                    height: imageSize.height,
                                    position: 'absolute',
                                    // center initially
                                    left: (workingWidth - imageSize.width) / 2,
                                    top: (workingHeight - imageSize.height) / 2,
                                },
                                animatedImageStyle
                            ]} 
                            resizeMode="contain"
                        />
                    </Animated.View>
                </GestureDetector>

                {/* Main Crop Mask Overlay */}
                <View style={styles.maskContainer} pointerEvents="none">
                    <View style={[
                        styles.cropWindow, 
                        { width: windowWidth, height: windowHeight, borderColor: mode === 'crop' ? colors.primary : '#FFF5' }
                    ]}>
                        {mode === 'crop' && (
                            <View style={styles.gridLines}>
                                <View style={styles.gridLineV} />
                                <View style={[styles.gridLineV, { left: '66.6%' }]} />
                                <View style={styles.gridLineH} />
                                <View style={[styles.gridLineH, { top: '66.6%' }]} />
                            </View>
                        )}
                    </View>
                </View>

                {/* Thumbnail Picker Overlay (Only in thumbnail mode) */}
                {mode === 'thumbnail' && (
                    <Animated.View style={[styles.thumbMaskContainer, animatedThumbMaskStyle]} pointerEvents="none">
                        <View style={[
                            styles.cropWindow, 
                            { width: windowWidth * 0.6, height: windowWidth * 0.6 * (4/3), borderColor: colors.secondary, borderWidth: 3 }
                        ]}>
                            <Text style={styles.thumbLabel}>Thumbnail (3:4)</Text>
                        </View>
                    </Animated.View>
                )}
            </View>

            {/* Controls */}
            <View style={[styles.controls, { paddingBottom: Math.max(effectiveInsets.bottom, 16) }]}>
                {/* Mode Switcher */}
                <View style={styles.modeTabs}>
                    <TouchableOpacity onPress={() => setMode('crop')} style={[styles.modeTab, mode === 'crop' && styles.activeMode]}>
                        <Text style={[styles.modeTabText, mode === 'crop' && { color: colors.primary }]}>Crop & Rotate</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setMode('thumbnail')} style={[styles.modeTab, mode === 'thumbnail' && styles.activeMode]}>
                        <Text style={[styles.modeTabText, mode === 'thumbnail' && { color: colors.primary }]}>Thumbnail Box</Text>
                    </TouchableOpacity>
                </View>

                {mode === 'crop' && (
                    <View style={styles.toolRow}>
                        {/* Aspect Ratio Picker */}
                        <TouchableOpacity onPress={() => setAspectRatio(0)} style={styles.toolBtn}>
                            <Text style={styles.toolText}>Free</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setAspectRatio(1)} style={styles.toolBtn}>
                            <Text style={styles.toolText}>1:1</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setAspectRatio(0.75)} style={styles.toolBtn}>
                            <Text style={styles.toolText}>3:4</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setAspectRatio(1.33)} style={styles.toolBtn}>
                            <Text style={styles.toolText}>4:3</Text>
                        </TouchableOpacity>
                        
                        {/* Rotation Slider */}
                        <View style={styles.rotationWrapper}>
                            <Ionicons name="refresh" size={16} color="#FFF" />
                            <GestureDetector gesture={rotationPanGesture}>
                                <View style={styles.sliderTrack}>
                                    <View style={styles.sliderThumb} />
                                </View>
                            </GestureDetector>
                        </View>
                    </View>
                )}
                {mode === 'thumbnail' && (
                    <View style={styles.toolRow}>
                        <Text style={styles.hintText}>Drag and pinch to set the 3:4 thumbnail area.</Text>
                    </View>
                )}
            </View>
        </GestureHandlerRootView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 16,
        backgroundColor: '#111',
        zIndex: 10,
    },
    headerTitle: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600',
    },
    saveText: {
        color: '#0A84FF',
        fontSize: 16,
        fontWeight: 'bold',
    },
    imageContainer: {
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    gestureView: {
        width: '100%',
        height: '100%',
        position: 'absolute',
    },
    maskContainer: {
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
    },
    thumbMaskContainer: {
        position: 'absolute',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        height: '100%',
    },
    cropWindow: {
        borderWidth: 2,
        backgroundColor: 'transparent',
    },
    thumbLabel: {
        position: 'absolute',
        top: -24,
        alignSelf: 'center',
        color: '#FFF',
        fontSize: 12,
        fontWeight: 'bold',
        backgroundColor: 'rgba(0,0,0,0.5)',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    gridLines: {
        ...StyleSheet.absoluteFillObject,
    },
    gridLineV: {
        position: 'absolute',
        top: 0, bottom: 0,
        width: 1,
        backgroundColor: 'rgba(255,255,255,0.4)',
        left: '33.3%',
    },
    gridLineH: {
        position: 'absolute',
        left: 0, right: 0,
        height: 1,
        backgroundColor: 'rgba(255,255,255,0.4)',
        top: '33.3%',
    },
    controls: {
        backgroundColor: '#111',
        paddingHorizontal: 20,
        paddingTop: 16,
    },
    modeTabs: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: 16,
    },
    modeTab: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderBottomWidth: 2,
        borderColor: 'transparent',
    },
    activeMode: {
        borderColor: '#0A84FF',
    },
    modeTabText: {
        color: '#888',
        fontWeight: '600',
    },
    toolRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
    },
    toolBtn: {
        padding: 8,
        backgroundColor: '#222',
        borderRadius: 6,
    },
    toolText: {
        color: '#FFF',
        fontSize: 12,
    },
    hintText: {
        color: '#AAA',
        textAlign: 'center',
        width: '100%',
    },
    rotationWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginLeft: 16,
        paddingVertical: 10,
    },
    sliderTrack: {
        flex: 1,
        height: 4,
        backgroundColor: '#444',
        marginLeft: 12,
        borderRadius: 2,
        justifyContent: 'center',
    },
    sliderThumb: {
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: '#FFF',
        alignSelf: 'center', // center position indicates 0 degrees
    }
});
