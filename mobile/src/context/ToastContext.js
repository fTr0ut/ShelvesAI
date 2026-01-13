import React, { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(null);

/**
 * Toast types and their default configurations
 */
const TOAST_CONFIG = {
    success: { duration: 4000, icon: 'checkmark-circle' },
    warning: { duration: 5000, icon: 'alert-circle' },
    error: { duration: 6000, icon: 'close-circle' },
    info: { duration: 4000, icon: 'information-circle' },
};

/**
 * ToastProvider component
 * Wrap your app with this to enable toast notifications
 */
export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);

    const showToast = useCallback(({
        message,
        type = 'info',
        duration,
        actionLabel,
        onAction,
    }) => {
        const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const config = TOAST_CONFIG[type] || TOAST_CONFIG.info;
        const toastDuration = duration ?? config.duration;

        const toast = {
            id,
            message,
            type,
            icon: config.icon,
            actionLabel,
            onAction,
            visible: true,
        };

        setToasts(prev => [...prev, toast]);

        // Auto-dismiss after duration
        if (toastDuration > 0) {
            setTimeout(() => {
                dismissToast(id);
            }, toastDuration);
        }

        return id;
    }, []);

    const dismissToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const value = {
        toasts,
        showToast,
        dismissToast,
    };

    return (
        <ToastContext.Provider value={value}>
            {children}
        </ToastContext.Provider>
    );
}

/**
 * Hook to access toast functionality
 */
export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
}

export default ToastContext;
