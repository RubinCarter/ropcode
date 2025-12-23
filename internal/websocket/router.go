// internal/websocket/router.go
package websocket

import (
	"fmt"
	"reflect"
)

// Router 将 RPC 方法映射到 App 方法
type Router struct {
	app     interface{}
	methods map[string]reflect.Method
}

// NewRouter 创建新的路由器
func NewRouter(app interface{}) *Router {
	r := &Router{
		app:     app,
		methods: make(map[string]reflect.Method),
	}

	// 通过反射获取所有公开方法
	appType := reflect.TypeOf(app)
	for i := 0; i < appType.NumMethod(); i++ {
		method := appType.Method(i)
		// 只注册公开方法（首字母大写）
		if method.IsExported() {
			r.methods[method.Name] = method
		}
	}

	return r
}

// Call 调用指定的 RPC 方法
func (r *Router) Call(methodName string, params []interface{}) (interface{}, error) {
	method, ok := r.methods[methodName]
	if !ok {
		return nil, fmt.Errorf("method not found: %s", methodName)
	}

	// 准备参数
	methodType := method.Type
	numIn := methodType.NumIn() - 1 // 减去 receiver

	if len(params) != numIn {
		return nil, fmt.Errorf("method %s expects %d params, got %d", methodName, numIn, len(params))
	}

	// 构建调用参数
	args := make([]reflect.Value, numIn+1)
	args[0] = reflect.ValueOf(r.app)

	for i, param := range params {
		expectedType := methodType.In(i + 1)
		paramValue, err := convertParam(param, expectedType)
		if err != nil {
			return nil, fmt.Errorf("param %d: %w", i, err)
		}
		args[i+1] = paramValue
	}

	// 调用方法
	results := method.Func.Call(args)

	// 处理返回值
	return processResults(results)
}

// convertParam 将 JSON 解析的值转换为目标类型
func convertParam(param interface{}, targetType reflect.Type) (reflect.Value, error) {
	if param == nil {
		return reflect.Zero(targetType), nil
	}

	paramValue := reflect.ValueOf(param)

	// 如果类型直接匹配，直接返回
	if paramValue.Type().AssignableTo(targetType) {
		return paramValue, nil
	}

	// 处理数字类型转换（JSON 数字默认是 float64）
	if paramValue.Kind() == reflect.Float64 {
		switch targetType.Kind() {
		case reflect.Int:
			return reflect.ValueOf(int(param.(float64))), nil
		case reflect.Int64:
			return reflect.ValueOf(int64(param.(float64))), nil
		case reflect.Int32:
			return reflect.ValueOf(int32(param.(float64))), nil
		case reflect.Uint:
			return reflect.ValueOf(uint(param.(float64))), nil
		case reflect.Uint32:
			return reflect.ValueOf(uint32(param.(float64))), nil
		case reflect.Uint64:
			return reflect.ValueOf(uint64(param.(float64))), nil
		}
	}

	// 尝试类型转换
	if paramValue.Type().ConvertibleTo(targetType) {
		return paramValue.Convert(targetType), nil
	}

	return reflect.Value{}, fmt.Errorf("cannot convert %T to %s", param, targetType)
}

// processResults 处理方法返回值
func processResults(results []reflect.Value) (interface{}, error) {
	switch len(results) {
	case 0:
		return nil, nil
	case 1:
		// 检查是否是 error
		if results[0].Type().Implements(reflect.TypeOf((*error)(nil)).Elem()) {
			if !results[0].IsNil() {
				return nil, results[0].Interface().(error)
			}
			return nil, nil
		}
		return results[0].Interface(), nil
	case 2:
		// 假设第二个是 error
		var err error
		if !results[1].IsNil() {
			err = results[1].Interface().(error)
		}
		if err != nil {
			return nil, err
		}
		return results[0].Interface(), nil
	default:
		// 多个返回值，返回数组
		var result []interface{}
		for i := 0; i < len(results)-1; i++ {
			result = append(result, results[i].Interface())
		}
		// 检查最后一个是否是 error
		last := results[len(results)-1]
		if last.Type().Implements(reflect.TypeOf((*error)(nil)).Elem()) && !last.IsNil() {
			return nil, last.Interface().(error)
		}
		return result, nil
	}
}
