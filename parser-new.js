
const { AST } = require("./ast");
const SYMBOLS = require("./symbols").SYMBOLS;
// const types = require("./old_type");

const FRIENDLY_NAMES = {
    ...objectFlip(SYMBOLS),
    "identifier": "a word",
    "number": "a number",
    "string": "a string",
    "EOF": "end of file"
}

const OPS_TO_SYMBOLS = objectFlip(SYMBOLS, false);

function objectFlip(obj, addQuotes = true) {
    const ret = {};
    Object.keys(obj).forEach(key => {
      ret[obj[key]] = addQuotes? ("'" + key + "'") : key;
    });
    return ret;
}

function ast(type, firstToken, lastToken, props) {
    return new AST(type, {
        firstToken: firstToken,
        lastToken: lastToken,
        ...props
    });
}

const TRAVERSE_OPERATORS = [ "colon", "dot", "pound", "nullco" ];
const UNARY_OPS = [ "minus", "not", "ellipses" ];

const TRAVERSE_START_TOKENS = [ 
    "number", 
    "string", 
    "open_square", 
    "open_curly", 
    "identifier", 
    "backslash", 
    "thin_arrow", 
    "arrow", 
    "dollar",
    "open_paren",
    "unit",
    "excl",
    "selfindex",
    "at"
]

const TRAVERSE_START_KEYWORDS = [
    "true",
    "false"
]

class Parser {

    tokens = [ ]
    offset = 0

    constructor(tokens) {
        this.tokens = tokens;
    }

    generateBinop(below, ...operators) {
        return () => {
            const instances = [ below() ];
            const ops = [ ];

            let t = this.peek();
            while(operators.includes(t.type) || operators.some(x => this.isKeyword(x))) {
                this.eat();
                ops.push(OPS_TO_SYMBOLS[t.type] || t.value);
                instances.push(below());
                t = this.peek();
            }

            let e = instances.shift();
            while(ops.length > 0) {
                const right = instances.shift();
                e = {
                    type: "binop",
                    op: ops.shift(),
                    left: e,
                    firstToken: e.firstToken,
                    right: right,
                    lastToken: right.lastToken
                }
            }

            return e;
        }
    }

    generateError(text, offender) {
        if(!offender) throw "NO OFFENDING TOKEN. ERROR TEXT: " + text;
        const pos = offender.pos;
        // console.log(offender);
        const error = Error("SYNTAX ERROR @ Ln " + pos.ln + ", col " + pos.col + " -- " + text);
        error.type = "parser";
        error.rawMessage = text;
        error.offset = pos.offset;
        error.pos = pos;
        error.length = offender.length;
        return error;
    }

    peek(offset = 0) {
        if(this.offset + offset >= this.tokens.length) {
            return this.tokens[this.tokens.length - 1];
        }
        // else if(this.offset < 0) {
        //     throw "wtf";
        // }

        // console.log(this.offset + offset);
        return this.tokens[this.offset + offset]
    }

    eat(type) {
        const t = this.peek();
        if(type && t.type != type) {
            throw this.generateError("Expected " + FRIENDLY_NAMES[type] + " but got " + t.friendlyName, t);
        }
        // if(t.value == "in") 
        // console.log("AT EIN");
        this.offset++;
        return t;
    }

    eatAny(...types) {
        const t = this.peek();
        if(!types.includes(t.type)) {
            throw this.generateError("Expected one of: " + types.slice(0, types.length - 1).map(x => FRIENDLY_NAMES[x]).join("; ") + " or " + FRIENDLY_NAMES[types[types.length - 1]] + ", but got " + t.friendlyName, t);
        }
        this.offset++;
        return t;
    }

    eatAnyKeyword(...values) {
        const t = this.peek();
        if(t.type != "keyword" || !values.includes(t.value)) {
            throw this.generateError("Expected one of: " + values.slice(0, values.length - 1).join("; ") + " or " + FRIENDLY_NAMES[values[values.length - 1]] + ", but got " + t.friendlyName, t);
        }
        this.offset++;
        return t;
    }

    skip(amt = 1) {
        this.offset += amt;
    }

    skipAny(...types) {
        let t = this.peek();
        while (types.includes(t.type)) {
            this.offset++;
            t = this.peek();
        } 
    }

    identifier() {
        return this.eat("identifier").value;
    }

    keyword(value) {
        const t = this.peek();
        if(t.type != "keyword" || t.value != value) {
            throw this.generateError("Expected '" + value + "' but got " + t.friendlyName, t);
        }
        // if(t.value == "in") console.log("ATE IN");
        this.offset++;
        return t;
    }

    isKeyword(kind) {
        const t = this.peek();
        return t.type == "keyword" && t.value == kind;
    }

    recover() {
        while(!this.isKeyword("import") && !this.isKeyword("export") && !this.isKeyword("let") && !this.isKeyword("set") && this.peek().type != "EOF") {
            this.offset++;
        }
    }

    tryDo(errors, f) {
        try {
            return f();
        }
        catch (e) {
            errors.push(e);
            this.recover();
        }
    }


    program() {

        const imports = [ ];
        const errors = [ ];
        while(this.isKeyword("import")) {
            this.eat();
            this.tryDo(errors, () => imports.push(this.string()));
        }

        const decs = [ ];

        while(true) {
            while(this.isKeyword("let") || this.isKeyword("set")) {
                this.tryDo(errors, () => decs.push(this.declaration()));
            }

            if(!this.isKeyword("export") && this.peek().type != "EOF") {
                errors.push(
                    this.generateError(
                        "Expected a 'let', 'set', or 'export' statement, but got " + this.peek().friendlyName, 
                        this.peek()));
                
                this.recover();
                continue;
            }

            break;
        }
            

        let ex = [ ];
        if(this.isKeyword("export")) {
            this.eat();
            const items = this.listOf(this.identifier.bind(this), "EOF");
            this.tryDo(errors, () => ex = items.elements);
        }

        const t = this.peek();
        if(t.type == "keyword") {
            if(t.value == "export") {
                errors.push(this.generateError("There can only be one export statement in a program.", t));
            }
            else if(t.value == "import") {
                errors.push(this.generateError("Import statements must be placed before all declarations.", t));
            }
            else {
                errors.push(this.generateError("An export statement must be the last statement in a program.", t));
            }
        }
                // throw this.generateError("A program can ")
            // if(this.peek().type == "EOF") {
            //     this.eat();
            // }
            // else {
                
            // }

        
        // while(false);
        
        this.tryDo(errors, () => this.eat("EOF"));

        return {
            imports: imports,
            export: ex,
            definitions: decs,
            errors: errors
        }
    }

    foreign() {
        const begin = this.keyword("foreign");
        const name = this.identifier();
        this.eat("square");
        const type = this.typeExpression();
        return ast("foreign_dec", begin, type.lastToken, {
            name: name,
            type: type
        });
    }

    simpleDefinition() {
        const begin = this.keyword("let");
        const name = this.identifier();
        this.eat("equals");
        const value = this.expression();
        // console.log(this.peek());
        return ast("simple_def", begin, value.lastToken, {
            name: name,
            value: value
        });
    }

    arrayDestructure() {
        const begin = this.keyword("let");
        this.eat("open_square");
        const head = this.listOf(this.identifier.bind(this), "ellipses", "close_square");
        let tail;
        if(head.end.type == "ellipses") {
            tail = this.listOf(this.identifier.bind(this), "close_square");
        }
        this.eat("equals");
        const value = this.expression();
        return ast("array_destructure", begin, tail? tail.end : head.end, {
            head: head.elements,
            tail: tail? tail.elements : [ ],
            value: value
        });
    }

    tableDestructureElement() {
        const t = this.peek();
        if(t.type == "dot") {
            this.eat();
            const name = this.eat("identifier");
            return {
                name: name.value,
                index: ast("string", t, name, { value: name.value })
            }
        }
        else {
            const name = this.identifier();
            this.eat("equals");
            const t = this.peek();
            if(t.type == "dot") {
                this.eat();
                const index = this.eat("identifier");
                return {
                    name: name,
                    index: ast("string", t, index, { value: index.value })
                }
            }
            else return {
                name: name,
                index: this.expression()
            }
        }
    }

    tableDestructure() {
        const begin = this.keyword("let");
        this.eat("open_curly");
        const items = this.listOf(this.tableDestructureElement.bind(this), "close_curly");
        this.eat("equals");
        const value = this.expression();

        return ast("table_destructure", begin, value.lastToken, {
            pairs: items.elements,
            value: value
        });
    }

    expression() {
        if(this.isKeyword("let")) {
            return this.letIn();
        }
        else if(this.isKeyword("set")) {
            return this.assignment();
        }
        else if(this.isKeyword("do")) {
            return this.do();
        }
        else if(this.isKeyword("cases")) {
            return this.cases();
        }
        else if(this.isKeyword("if")) {
            return this.ifExpr();
        }
        else {
            const t = this.peek();
            switch(t.type) {
                case "thin_arrow": {
                    this.eat();
                    const body = this.expression();
                    return ast("function", t, body.lastToken, {
                        parameters: [ ],
                        result: body
                    });
                }
    
                case "arrow": {
                    this.eat();
                    const body = this.expression();
                    return ast("function", t, body.lastToken, {
                        parameters: [ { name: "self", token: t, variadic: false } ],
                        result: body
                    });
                }

                default: return this.booleanOp();
            }
        }
    }

    ifExpr() {
        const begin = this.keyword("if");
        const cond = this.expression();
        this.keyword("then");
        const trueBody = this.expression();
        let falseBody;
        if(this.peek().type == "keyword" && this.peek().value == "else") {
            this.keyword("else");
            falseBody = this.expression();
        }
        else {
            falseBody = ast("nil", trueBody.firstToken, trueBody.lastToken);
        }

        return ast("when_expr", begin, falseBody.lastToken, {
            branches: [ {
                condition: cond,
                value: trueBody
            } ],
            else_value: falseBody
        }); 
    }

    cases() {
        const begin = this.keyword("cases");

        const branches = [ ];
        while(this.peek().type == "union" && this.peek(1).type != "keyword" && this.peek(1).value != "else") {
            this.eat();
            const condition = this.expression();
            this.separator();
            const result = this.expression();
            branches.push({
                condition: condition,
                value: result
            });
        }

        this.eat("union");
        this.keyword("else");
        this.separator();

        const elseValue = this.expression();

        return ast("when_expr", begin, elseValue.lastToken, {
            branches: branches,
            else_value: elseValue
        });
    }

    do() {
        const begin = this.keyword("do");

        const res = this.listOfKeywordTerminated(this.expression.bind(this), "then", "end");
        
        let next;
        // console.log(this.peek().type);
        if(res.end.value == "then") {
            next = this.expression();
        }
        else {
            next = ast("nil", res.end, res.end);
        }

        return ast("do_expr", begin, next.lastToken, {
            expressions: res.elements,
            next: next
        });
    }

    letIn() {
        const dec = this.declaration();
        let expr;
        let hasInBranch;
        // console.log(this.peek());
        if(hasInBranch = this.isKeyword("in")) 
        {
            // this.eat();
            this.keyword("in");
            // console.log(this.peek());
            expr = this.expression();
            // hasInBranch = true;
        }
        else expr = ast("nil", dec.firstToken, dec.lastToken);

        return ast("let_in_expr", dec.firstToken, expr.lastToken, {
            definition: dec,
            expression: expr,
            hasInBranch: hasInBranch
        });
    }

    assignment() {
        const begin = this.keyword("set");
        const left = this.traverse(true);
        this.eat("equals");
        const right = this.expression();
        return ast("assignment", begin, right.lastToken, {
            left: left,
            right: right
        });
    }

    declaration() {
        if(this.isKeyword("let")) {
            const o = this.offset;
            this.keyword("let");
            switch(this.peek().type) {
                case "open_square": {
                    this.offset = o;
                    return this.arrayDestructure();
                }
                case "open_curly": {
                    this.offset = o;
                    return this.tableDestructure();
                }
                default: {
                    this.offset = o;
                    return this.simpleDefinition();
                }
            }
        }
        else if(this.isKeyword("set")) {
            return this.assignment();
        }
        else {
            throw this.generateError("Expected a 'let' or 'set' statement, but got " + this.peek().friendlyName, this.peek());
        }
    }
    
    multiplicative = this.generateBinop(this.unary.bind(this), "times", "divide", "floor_div", "percent");
    
    additive = this.generateBinop(this.multiplicative.bind(this), "plus", "minus", "str_concat", "array_concat");

    comparative = this.generateBinop(this.additive.bind(this), "lt", "gt", "geq", "leq");

    equality = this.generateBinop(this.comparative.bind(this), "eq", "neq");
    
    booleanOp = this.generateBinop(this.equality.bind(this), "or", "and");

    unary() {
        const t = this.peek();
        if(UNARY_OPS.includes(t.type)) {
            this.eat();
            const right = this.unary();
            return ast("unary", t, right.lastToken, {
                op: OPS_TO_SYMBOLS[t.type],
                right: right
            });
        }
        else {
            return this.exponent();
        }
    }
    
    // (A ??? (??A ??? B)) ??? (A ??? B)

    exponent = this.generateBinop(this.application.bind(this), "exponent");
    // exponent = this.generateBinop(this.typeAnnotation.bind(this), "exponent");

    // typeExpression() {
    //     return this.typeFunction();
    // }

    // typeFunctionArg() {
    //     const t = this.typeTerminal();
    //     let variadic = false;
    //     let vToken;
    //     if(this.peek().type == "ellipses") {
    //         vToken = this.eat();
    //         variadic = true;
    //     }
    //     return {
    //         type: t,
    //         variadic: variadic,
    //         vToken: vToken
    //     }
    // }

    // typeFunction() {
    //     const o = this.offset;
    //     this.typeTerminal();
    //     const lookAhead = this.peek().type;
    //     this.offset = o;

    //     if(lookAhead == "comma" || lookAhead == "semicolon" || lookAhead == "thin_arrow" || lookAhead == "ellipses") {

    //         const args = this.listOf(this.typeFunctionArg.bind(this), "thin_arrow");
    //         for (let i = 0; i < args.elements.length; i++) {
    //             if(args.elements[i].variadic && i != args.elements.length - 1)
    //                 throw this.generateError("The variadic argument must be the last argument in a function.", args.elements[i].vToken);
    //         }

    //         const right = this.typeTerminal();

    //         let f = {
    //             type: "function",
    //             args: args.elements.map(x => x.type),
    //             variadic: args.elements.some(x => x.variadic),
    //             result: right
    //         };

    //         for (let i = 0; i < f.args.length; i++) {
    //             // console.log(f);
    //             const replacements = types.matchGeneric(f.args[i], f.args[i]);
    //             for (const r of replacements) {
    //                 f = types.replaceGeneric(f, r.generic, r.bound);
    //             }
    //         }

    //         return f;
    //     }
    //     else return this.typeTerminal();

    // }

    // typeSuperset() {
    //     if(this.peek().type == "identifier") {
    //         const o = this.offset;
    //         const name = this.identifier();
    //         if(!PRIMITIVE_TYPES.includes(name) && ) {
                
    //         }
    //         else {
    //             this.offset = 0;
    //         }
    //     }
    //     else return this.typeTerminal();
    // }

    // typeTable() {
    //     this.eat("open_curly");
    //     const field = () => {
    //         const name = this.identifier();
    //         this.eat("square");
    //         const type = this.typeTerminal();
    //         return {
    //             field: name,
    //             type: type
    //         }
    //     }
    //     const pairs = this.listOf(field, "close_curly");
    //     return types.tableOf(pairs.elements);
    // }

    // typeTerminal() {
    //     const t = this.peek();
    //     if(t.type == "unit") {
    //         this.eat();
    //         return "()";
    //     }
    //     else if(t.type == "identifier") {
    //         this.eat();
    //         if(types.PRIMITIVE_TYPES.includes(t.value)) {
    //             return t.value
    //         }
    //         else {
    //             let extending;
    //             if(this.peek().type == "geq") {
    //                 this.eat();
    //                 extending = this.typeTable();
    //             }
    //             return {
    //                 type: "generic",
    //                 name: t.value,
    //                 extending: extending
    //             }
    //         }
    //         // else throw this.generateError("Expected a primitive type but got '" + t.value + "'.", t);
    //     }
    //     else if(t.type == "open_paren") {
    //         this.eat();
    //         const inner = this.typeExpression();
    //         this.eat("close_paren");
    //         return inner;
    //     }
    //     else if(t.type == "open_square") {
    //         this.eat();
    //         const inner = this.typeExpression();
    //         this.eat("close_square");
    //         return types.arrayOf(inner);
    //     }
    //     else if(t.type == "open_curly") {
    //         return this.typeTable();
    //     }
    //     else throw this.generateError("Expected a type, but got " + (FRIENDLY_NAMES[t.type] || t.type) + ".", t);
    // }

    // typeAnnotation() {
    //     if(this.peek().type == "dollar") {
    //         const begin = this.eat();
    //         const type = this.typeExpression();
    //         this.eat("square");
    //         const right = this.application();
    //         return ast("type_annotation", begin, right.lastToken, {
    //             annotation: type,
    //             expression: right
    //         });
    //     }
    //     else return this.application();
    // }

    application() {
        if(this.isKeyword("try")) {
            return this.try();
        }
        else {
            const left = this.traverse();

            const args = [ ];
            let t = this.peek();
            while(TRAVERSE_START_TOKENS.includes(t.type) || (t.type == "keyword" && TRAVERSE_START_KEYWORDS.includes(t.value))) {
                args.push(this.traverse());
                t = this.peek();
            }

            // do {
            //     let o = this.offset;
            //     try {
            //         args.push(this.traverse());
            //     } catch {
            //         this.offset = o;
            //         break;
            //     }
            // } while (true);

            if(args.length < 1) {
                return left;
            } 
            else {
                return ast("application", left.firstToken, args[args.length - 1].lastToken, {
                    f: left,
                    args: args
                });
            }
        }
    }

    try() {
        const begin = this.keyword("try");
        const body = this.application();
        let falseBranch;
        let end = body.lastToken;
        if(this.isKeyword("or")) {
            this.eat();
            falseBranch = this.booleanOp();
            end = falseBranch.lastToken;
        }
        return ast("try", begin, end, {
            body: body,
            false_branch: falseBranch
        });
    }

    methodCall() {
        this.eat("colon");
        const name = this.identifier();
        
        const args = [ ];
        do {
            let o = this.offset;
            try {
                args.push(this.traverse());
            } catch {
                this.offset = o;
                break;
            }
        } while (true);

        if(args.length == 0)
            throw this.generateError("Expected one or more arguments to the method '" + name + "' but got " + this.peek().friendlyName, this.peek());

        return {
            type: "method_call",
            name: name,
            args: args,
            lastToken: args[args.length - 1].lastToken
        }
    }

    index() {
        this.eat("pound");
        const index = this.terminal();
        return {
            type: "index",
            index: index,
            lastToken: index.lastToken
        }
    }

    property() {
        this.eat("dot");
        const t = this.eat("identifier");
        return {
            type: "property",
            name: t.value,
            lastToken: t
        }
    }

    nullCoalesce() {
        this.eat("nullco");
        const t = this.eat("identifier");
        return {
            type: "nullco",
            name: t.value,
            lastToken: t
        }
    }

    traverse(lvalue = false) {
        let e = this.terminal();
        const begin = e.firstToken;
        let t = this.peek();
        while(TRAVERSE_OPERATORS.includes(t.type)) {

            let traversal;
            switch(t.type) {
                case "dot": { traversal = this.property(); break }
                case "pound": { traversal = this.index(); break }
                case "colon": { traversal = this.methodCall(); break }
                case "nullco": { traversal = this.nullCoalesce(); break }
            }

            e = {
                firstToken: begin,
                table: e,
                ...traversal
            }

            t = this.peek();
        }

        if(e.type == "method_call" && lvalue) {
            throw this.generateError("A method call cannot be on the left hand side of an equals operation", e.firstToken);
        }

        return e;
    }

    terminal() {
        const t = this.peek();
        switch(t.type) {

            case "at": {
                this.eat();
                return ast("variable", t, t, { name: "self" });
            }

            case "selfindex": {
                this.eat();
                return ast("property", t, t, { 
                    table: ast("variable", t, t, { name: "self" }),
                    name: t.value
                });
            }

            case "number": {
                this.eat();
                return ast("number", t, t, { value: t.value });
            }

            case "string": return this.string();

            case "identifier": {
                this.eat();
                return ast("variable", t, t, { name: t.value });
            }

            case "excl":
            case "unit": {
                this.eat();
                return ast("nil", t, t);
            }

            case "open_paren": {
                this.eat();
                const inner = this.expression();
                this.eat("close_paren");
                return inner;
            }

            case "open_square": {
                const o = this.offset;
                this.eat();
                
                if(this.peek().type == "close_square") {
                    this.offset = o;
                    return this.array();
                }
                else {
                    this.expression();
                }

                if(this.peek().type == "union") {
                    this.offset = o;
                    return this.arrayComprehension();
                }
                else {
                    this.offset = o;
                    return this.array();
                }
            }

            case "open_curly": {
                return this.table();
            }

            case "backslash": {
                return this.function();
            }

            case "dollar": {
                this.eat();
                return this.expression();
            }

            case "keyword": {
                switch(t.value) {
                    case "true":
                    case "false": {
                        this.eat();
                        return ast("boolean", t, t, { value: t.value == "true" });
                    }
                }
            }
        }

        throw this.generateError("Expected a value or a parenthesised expression, but got " + t.friendlyName, t);
    }

    separator() {
        this.eatAny("comma", "semicolon");
    }

    string() {
        const t = this.eat("string");
        return ast(
            t.interpolations.length == 0? "string" : "fstring", 
            t, t,
            {
                value: t.value,
                format_values: t.interpolations.map(x => new Parser(x).expression())
            }
        );
    }

    functionParameter() {
        const name = this.eat("identifier");

        let variadic = false;
        if(this.peek().type == "ellipses") {
            this.eat();
            variadic = true;
        }

        let value;
        if(this.peek().type == "equals") {
            this.eat();
            value = this.expression();
        }

        return {
            name: name.value,
            token: name,
            variadic: variadic,
            defaultValue: value
        }
    }

    function() {
        const begin = this.eat("backslash");
        const args = (() => {
            const a = [ ]
            let t = this.peek().type;
            if(t == "dot") {
                this.eat();
                const eaten = this.eatAny("arrow", "thin_arrow");
                return [ { name: eaten.type == "thin_arrow"? "_" : "self", token: t, variadic: false } ];
            }
            else {
                while(t != "arrow" && t != "thin_arrow") {
                    a.push(this.functionParameter());
                    const tok = this.peek();
                    t = tok.type;
                    if(t == "comma" || t == "semicolon") {
                        this.eat();
                    }
                    else if(t != "arrow" && t != "thin_arrow") {
                        throw this.generateError("Expected '->' or '=>' to begin function declaration, but got " + tok.friendlyName, tok);
                    }
                    else {
                        if(t == "arrow")
                            a.unshift({ name: "self" });
                        
                        this.eatAny("arrow", "thin_arrow");
                        return a;
                    }
                }

                if(this.peek().type == "arrow")
                    a.unshift({ name: "self" });
                
                this.eatAny("arrow", "thin_arrow");
                return a;
            }
        })();

        for (let i = 0; i < args.length; i++) {
            if(args[i].variadic && i != args.length - 1)
                throw this.generateError("The variadic argument must be the last argument in a function.", args[i].token);
        }

        const body = this.expression();
        const end = body.lastToken;

        return ast("function", begin, end, {
            parameters: args,
            result: body
        });
    }

    tableElement() {
        if(this.peek().type == "dot") {
            this.eat();
            const name = this.eat("identifier");
            const key = ast("string", name, name, { value: name.value });
            let value;
            if(this.peek().type == "equals") {
                this.eat();
                value = this.expression();
            }
            else {
                value = ast("variable", name, name, { name: name.value });
            }
            return {
                index: key,
                value: value
            }
        }
        else {
            const key = this.expression();
            this.eat("equals");
            const val = this.expression();
            return {
                index: key,
                value: val
            }
        }
    }

    listOf(parseFunction, ...endingTokens) {
        const elements = [ ];

        while(!endingTokens.includes(this.peek().type)) {
            elements.push(parseFunction());
            const t = this.peek().type;
            if(t == "comma" || t == "semicolon") {
                this.eat();
            }
            else {
                const end = this.eatAny(...endingTokens);
                return {
                    elements: elements,
                    end: end
                }
            }
        }

        const end = this.eatAny(...endingTokens);
        return {
            elements: elements,
            end: end
        }
    }

    listOfKeywordTerminated(parseFunction, ...endingKeywords) {
        const elements = [ ];

        while(!endingKeywords.includes(this.peek().type)) {
            elements.push(parseFunction());
            const t = this.peek().type;
            if(t == "comma" || t == "semicolon") {
                this.eat();
            }
            else {
                const end = this.eatAnyKeyword(...endingKeywords);
                return {
                    elements: elements,
                    end: end
                }
            }
        }

        const end = this.eatAnyKeyword(...endingTokens);
        return {
            elements: elements,
            end: end
        }
    }

    table() {
        const begin = this.eat("open_curly");

        const items = this.listOf(this.tableElement.bind(this), "close_curly");

        return ast("table", begin, items.end, {
            elements: items.elements
        });

        // const elements = [ ];
        // while(this.peek().type != "close_curly") {
        //     elements.push(this.tableElement());
        //     const t = this.peek().type;
        //     if(t == "comma" || t == "semicolon") {
        //         this.eat();
        //     }
        //     else {
        //         const end = this.eat("close_curly");
        //         return ast("table", begin, end, {
        //             elements: elements
        //         });
        //     }
        // }

        // const end = this.eat("close_curly");
        // return ast("table", begin, end, {
        //     elements: elements
        // });
    }

    arrayComprehension() {
        const begin = this.eat("open_square");
        const expr = this.expression();
        this.eat("union");
        const inVar = this.identifier();
        this.eat("left_thin_arrow");
        const collection = this.expression();
        const filters = [ ]
        while(this.peek().type == "comma" || this.peek().type == "semicolon") {
            this.eat();
            filters.push(this.expression());
        }
        const end = this.eat("close_square");
        return ast("array_comprehension", begin, end, {
            expression: expr,
            iter_var: inVar,
            collection: collection,
            filters: filters
        });
    }

    array() {
        const begin = this.eat("open_square");

        const items = this.listOf(this.expression.bind(this), "close_square");

        return ast("array", begin, items.end, {
            elements: items.elements
        });

        // const elements = [ ];
        // while(this.peek().type != "close_square") {
        //     elements.push(this.expression());
        //     const t = this.peek().type;
        //     if(t == "comma" || t == "semicolon") {
        //         this.eat();
        //     }
        //     else {
        //         const end = this.eat("close_square");
        //         return ast("array", begin, end, {
        //             items: elements
        //         });
        //     }
        // }

        // const end = this.eat("close_square");
        // return ast("array", begin, end, {
        //     items: elements
        // });
    }

}

exports.Parser = Parser;
