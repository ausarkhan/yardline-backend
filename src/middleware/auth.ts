// Authentication middleware for YardLine API
import { Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';

// Extend Express Request to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
      };
    }
  }
}

/**
 * Middleware to verify Supabase JWT token
 * Expects Authorization header: Bearer <token>
 */
export function authenticateUser(supabase: SupabaseClient) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: {
            type: 'authentication_error',
            message: 'Missing or invalid authorization header. Expected: Authorization: Bearer <token>'
          }
        });
      }
      
      const token = authHeader.substring(7); // Remove 'Bearer ' prefix
      
      // Verify JWT with Supabase
      const { data: { user }, error } = await supabase.auth.getUser(token);
      
      if (error || !user) {
        return res.status(401).json({
          success: false,
          error: {
            type: 'authentication_error',
            message: 'Invalid or expired token'
          }
        });
      }
      
      // Attach user to request
      req.user = {
        id: user.id,
        email: user.email
      };
      
      next();
    } catch (error) {
      console.error('Authentication error:', error);
      return res.status(401).json({
        success: false,
        error: {
          type: 'authentication_error',
          message: 'Authentication failed'
        }
      });
    }
  };
}

/**
 * Optional auth middleware - allows both authenticated and anonymous requests
 * If token is provided and valid, attaches user to request
 */
export function optionalAuth(supabase: SupabaseClient) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const { data: { user } } = await supabase.auth.getUser(token);
        
        if (user) {
          req.user = {
            id: user.id,
            email: user.email
          };
        }
      }
      
      next();
    } catch (error) {
      // Silent fail for optional auth
      next();
    }
  };
}

/**
 * Middleware to verify user owns a resource
 * Must be used after authenticateUser middleware
 */
export function requireOwnership(userIdField: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          type: 'authentication_error',
          message: 'Authentication required'
        }
      });
    }
    
    const resourceUserId = req.body[userIdField] || req.params[userIdField] || req.query[userIdField];
    
    if (!resourceUserId) {
      return res.status(400).json({
        success: false,
        error: {
          type: 'invalid_request_error',
          message: `Missing ${userIdField} parameter`
        }
      });
    }
    
    if (req.user.id !== resourceUserId) {
      return res.status(403).json({
        success: false,
        error: {
          type: 'permission_denied',
          message: 'You do not have permission to access this resource'
        }
      });
    }
    
    next();
  };
}

/**
 * Middleware for admin-only routes
 * Checks if user has admin role in metadata
 */
export function requireAdmin(supabase: SupabaseClient) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          type: 'authentication_error',
          message: 'Authentication required'
        }
      });
    }
    
    try {
      // Check user metadata for admin role
      const { data: userData, error } = await supabase.auth.admin.getUserById(req.user.id);
      
      if (error || !userData) {
        return res.status(403).json({
          success: false,
          error: {
            type: 'permission_denied',
            message: 'Admin access required'
          }
        });
      }
      
      const isAdmin = userData.user.user_metadata?.role === 'admin' || 
                     userData.user.app_metadata?.role === 'admin';
      
      if (!isAdmin) {
        return res.status(403).json({
          success: false,
          error: {
            type: 'permission_denied',
            message: 'Admin access required'
          }
        });
      }
      
      next();
    } catch (error) {
      console.error('Admin check error:', error);
      return res.status(500).json({
        success: false,
        error: {
          type: 'api_error',
          message: 'Failed to verify admin status'
        }
      });
    }
  };
}
